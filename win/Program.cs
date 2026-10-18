// jizura-sync for Windows: the web app in WebView2, fed by the media sessions Windows keeps for
// every player (Spotify, Apple Music, a browser tab ...).
//
// Playback comes from the Global System Media Transport Controls -- the same sessions the volume
// flyout shows: title, artist, cover, timeline and play state, plus play / pause / next / previous
// / seek. No account, no Client ID. The page is served from web\ next to the exe through a
// virtual host, because WebView2 refuses ES modules from file:// URLs.
//
// Build: tools/build-win.ps1. Set JIZURA_WEB_ROOT=<repo>\web to serve the page from a checkout
// while editing it (reload with F5), JIZURA_QUERY=mock (or any query the page takes) to try it
// without a player, and JIZURA_LOG=<file> to log every reading and session event.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Windows.Graphics.Imaging;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace JizuraSync;

static class Program
{
    /** Where the page lives. It is also the origin of the page's localStorage: never change it. */
    public const string Host = "app.jizura-sync.test";
    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "jizura-sync");
    static readonly string? logFile = Environment.GetEnvironmentVariable("JIZURA_LOG");

    public static void Log(string message)
    {
        if (string.IsNullOrEmpty(logFile)) return;
        try { File.AppendAllText(logFile, $"{DateTime.Now:HH:mm:ss.fff} {message}\n"); } catch (IOException) { }
    }

    [STAThread]
    static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}

// MARK: - Players

/**
 * Reads the system's media sessions and posts one state object per reading to the page
 * (`NativePlayer` in web/native.js), which extrapolates the position in between. Lives on the UI
 * thread; the sessions' events arrive on other threads and are posted back to it.
 *
 * Sessions announce changes of track, play state and timeline, and a reading follows each one at
 * once. Not every player announces a seek, so while something plays the bridge also reads once a
 * second. Paused or idle, with no error to retry, it waits for an event.
 */
sealed class PlayerBridge
{
    const int PlayingIntervalMs = 1000;
    /** Retry after a failed read (a player busy or just quitting). */
    const int RetryIntervalMs = 2000;
    /** A session belongs to another process; one that stops answering must not hold up the rest. */
    static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(2);
    /** How long a seek may take to show up in the player's timeline before readings count again. */
    const int SeekSettleMs = 1000;

    readonly Action<string> send;
    readonly SynchronizationContext ui;
    readonly System.Windows.Forms.Timer timer = new();
    GlobalSystemMediaTransportControlsSessionManager? manager;
    List<GlobalSystemMediaTransportControlsSession> watched = [];
    bool busy;
    bool again;              // something asked for a reading while one was running
    bool playing;
    bool visible = true;
    string? followed;        // SourceAppUserModelId of the session followed last
    string? trackKey;
    JsonObject? track;
    bool metaStale;          // a session changed its metadata: read it again even for the same key
    int commandSeq;
    /**
     * A seek the player accepted but its timeline may not show yet: a player such as a browser
     * moves after TryChangePlaybackPositionAsync returns. Until a reading lands on it (or
     * SeekSettleMs passes), readings carry the seq before the seek, so the page drops them.
     */
    (string app, int seq, double ms, long at)? pendingSeek;
    readonly Dictionary<string, string> names = [];

    public PlayerBridge(Action<string> send)
    {
        this.send = send;
        ui = SynchronizationContext.Current ?? throw new InvalidOperationException("PlayerBridge needs the UI thread");
        timer.Tick += (_, _) => { timer.Stop(); PollNow(); };
    }

    /**
     * Whether the window is on screen. Minimised, it skips the once-a-second reading and lets
     * the display sleep; the sessions' events still keep the track current.
     */
    public bool Visible
    {
        get => visible;
        set
        {
            if (value == visible) return;
            visible = value;
            if (visible) PollNow(); else timer.Stop();
            UpdateAwake();
        }
    }

    /** Called by each page load, so a reload gets the current state too. */
    public async void Start()
    {
        commandSeq = 0;       // the new page counts its commands from 0
        pendingSeek = null;
        if (manager == null)
        {
            try
            {
                manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().WaitAsync(CallTimeout);
            }
            catch (Exception e)
            {
                Program.Log($"session manager: {e.Message}");
                Send(new JsonObject { ["seq"] = 0, ["error"] = new JsonObject { ["kind"] = "script", ["app"] = "Windows", ["detail"] = e.Message } });
                return;
            }
            manager.SessionsChanged += (_, _) => Changed("sessions", Rewatch);
            manager.CurrentSessionChanged += (_, _) => Changed("current");
            Rewatch();
        }
        PollNow();
    }

    void Changed(string what, Action? then = null) => ui.Post(_ =>
    {
        Program.Log($"event {what}");
        then?.Invoke();
        PollNow();
    }, null);

    void Rewatch()
    {
        foreach (var s in watched)
        {
            s.MediaPropertiesChanged -= OnMedia;
            s.PlaybackInfoChanged -= OnPlayback;
            s.TimelinePropertiesChanged -= OnTimeline;
        }
        watched = manager?.GetSessions().ToList() ?? [];
        foreach (var s in watched)
        {
            s.MediaPropertiesChanged += OnMedia;
            s.PlaybackInfoChanged += OnPlayback;
            s.TimelinePropertiesChanged += OnTimeline;
        }
    }

    void OnMedia(GlobalSystemMediaTransportControlsSession s, MediaPropertiesChangedEventArgs e) =>
        Changed($"media {s.SourceAppUserModelId}", () => metaStale = true);
    void OnPlayback(GlobalSystemMediaTransportControlsSession s, PlaybackInfoChangedEventArgs e) => Changed($"playback {s.SourceAppUserModelId}");
    void OnTimeline(GlobalSystemMediaTransportControlsSession s, TimelinePropertiesChangedEventArgs e) => Changed($"timeline {s.SourceAppUserModelId}");

    async void PollNow()
    {
        timer.Stop();
        if (busy) { again = true; return; }
        busy = true;
        JsonObject message;
        try { message = await Poll(); }
        catch (Exception e) { message = new JsonObject { ["seq"] = commandSeq, ["error"] = new JsonObject { ["kind"] = "transient", ["app"] = "Windows", ["detail"] = e.Message } }; }
        busy = false;
        Send(message);
        if (again) { again = false; PollNow(); } else ScheduleNext(message);
    }

    void ScheduleNext(JsonObject message)
    {
        int delay;
        if (message["error"] is JsonObject error)
        {
            if ((string?)error["kind"] == "idle") return;
            delay = RetryIntervalMs;
        }
        else if (pendingSeek is { } seek)
        {
            delay = (int)Math.Max(50, seek.at + SeekSettleMs - Environment.TickCount64);    // the reading that ends the wait
        }
        else
        {
            if ((bool?)message["playing"] != true || !visible) return;
            delay = PlayingIntervalMs;
        }
        timer.Interval = delay;
        timer.Start();
    }

    [Flags] enum ExecutionState : uint { Continuous = 0x80000000, DisplayRequired = 0x2 }
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(ExecutionState state);

    /** Keeps the display on while a song plays in view. Per thread: always called on the UI thread. */
    void UpdateAwake() =>
        SetThreadExecutionState(playing && visible ? ExecutionState.Continuous | ExecutionState.DisplayRequired : ExecutionState.Continuous);

    void Send(JsonObject message)
    {
        var nowPlaying = (bool?)message["playing"] == true;
        if (nowPlaying != playing) { playing = nowPlaying; UpdateAwake(); }
        var json = message.ToJsonString();
        Program.Log($"send {(json.Length > 400 ? json[..400] + "…" : json)}");
        send(json);
    }

    // Page → native: { cmd: 'start' } or { cmd: 'play' | 'pause' | 'next' | 'previous' | 'seek', ms?, seq }
    public async void Command(string cmd, JsonNode body)
    {
        var seq = (int?)body["seq"] ?? 0;
        var session = watched.FirstOrDefault(s => s.SourceAppUserModelId == followed);
        try
        {
            if (session != null)
            {
                var ms = Math.Max(0, (double?)body["ms"] ?? 0);
                Task<bool> call = cmd switch
                {
                    "play" => session.TryPlayAsync().AsTask(),
                    "pause" => session.TryPauseAsync().AsTask(),
                    "next" => session.TrySkipNextAsync().AsTask(),
                    "previous" => session.TrySkipPreviousAsync().AsTask(),
                    "seek" => session.TryChangePlaybackPositionAsync(
                        (session.GetTimelineProperties().StartTime + TimeSpan.FromMilliseconds(ms)).Ticks).AsTask(),
                    _ => Task.FromResult(true),
                };
                if (!await call.WaitAsync(CallTimeout)) Program.Log($"{cmd}: refused by {followed}");
                else if (cmd == "seek") pendingSeek = (session.SourceAppUserModelId, seq, ms, Environment.TickCount64);
            }
        }
        catch (Exception e) { Program.Log($"{cmd} failed: {e.Message}"); }
        commandSeq = Math.Max(commandSeq, seq);
        PollNow();
    }

    /** One reading of every session. */
    async Task<JsonObject> Poll()
    {
        var seq = commandSeq;       // the page drops readings started before its latest command
        if (manager == null) return new JsonObject { ["seq"] = seq, ["error"] = new JsonObject { ["kind"] = "idle", ["apps"] = new JsonArray() } };
        var sessions = manager.GetSessions().ToList();
        var current = manager.GetCurrentSession()?.SourceAppUserModelId;

        // Follow a session that is playing -- the one followed last, then the one Windows calls
        // current -- and while nothing plays, stay on a paused one in the same order.
        var candidates = new List<(GlobalSystemMediaTransportControlsSession session, bool playing)>();
        foreach (var s in sessions)
        {
            var status = s.GetPlaybackInfo()?.PlaybackStatus;
            if (status == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) candidates.Add((s, true));
            else if (status == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused) candidates.Add((s, false));
        }
        var ordered = candidates.OrderBy(c => c.playing ? 0 : 1)
            .ThenBy(c => c.session.SourceAppUserModelId == followed ? 0 : 1)
            .ThenBy(c => c.session.SourceAppUserModelId == current ? 0 : 1);

        string? failedApp = null, failure = null;
        foreach (var (session, isPlaying) in ordered)
        {
            var id = session.SourceAppUserModelId;
            GlobalSystemMediaTransportControlsSessionMediaProperties props;
            try { props = await session.TryGetMediaPropertiesAsync().AsTask().WaitAsync(CallTimeout); }
            catch (Exception e) { failedApp ??= AppName(id); failure ??= e.Message; continue; }
            if (string.IsNullOrEmpty(props?.Title)) continue;      // a tab with media but no metadata

            var timeline = session.GetTimelineProperties();
            var durationMs = Math.Max(0, (timeline.EndTime - timeline.StartTime).TotalMilliseconds);
            var positionMs = (timeline.Position - timeline.StartTime).TotalMilliseconds;
            // The position is as of LastUpdatedTime; a player may leave it there for many seconds.
            if (isPlaying && timeline.LastUpdatedTime.Year > 2000)
            {
                var rate = session.GetPlaybackInfo()?.PlaybackRate ?? 1;
                positionMs += Math.Max(0, (DateTimeOffset.Now - timeline.LastUpdatedTime).TotalMilliseconds) * rate;
            }
            if (durationMs > 0) positionMs = Math.Min(positionMs, durationMs);

            var artist = string.IsNullOrEmpty(props.Artist) ? props.AlbumArtist : props.Artist;
            // A player may set the length after the title: a new length is a new track to the page.
            var key = $"{id}:{props.Title}|{artist}|{props.AlbumTitle}|{Math.Round(durationMs / 1000)}";
            if (key != trackKey || metaStale || track == null)
            {
                metaStale = false;
                track = new JsonObject
                {
                    ["trackId"] = key,
                    ["title"] = props.Title,
                    ["artist"] = artist ?? "",
                    ["album"] = props.AlbumTitle ?? "",
                    ["durationMs"] = durationMs,
                    ["artUrl"] = await Thumbnail(props.Thumbnail),
                };
                trackKey = key;
            }
            followed = id;
            var readingSeq = seq;
            // A reading started before the seek was recorded carries an older seq; the page drops it anyway.
            if (pendingSeek is { } seek && seq >= seek.seq)
            {
                // Between the target and where playback could have got to since: the seek has landed.
                var elapsed = Environment.TickCount64 - seek.at;
                var landed = positionMs >= seek.ms - 250 && positionMs <= seek.ms + elapsed + 250;
                if (seek.app == id && seq == seek.seq && !landed && elapsed < SeekSettleMs)
                {
                    readingSeq = seq - 1;
                    Program.Log($"seek to {seek.ms:F0} not shown yet ({positionMs:F0})");
                }
                else pendingSeek = null;
            }
            return new JsonObject
            {
                ["seq"] = readingSeq, ["source"] = AppName(id), ["playing"] = isPlaying,
                ["positionMs"] = Math.Max(0, positionMs), ["track"] = track.DeepClone(),
            };
        }
        followed = null;
        if (failedApp != null) return new JsonObject { ["seq"] = seq, ["error"] = new JsonObject { ["kind"] = "script", ["app"] = failedApp, ["detail"] = failure } };
        var apps = new JsonArray(sessions.Select(s => AppName(s.SourceAppUserModelId)).Distinct().Select(n => (JsonNode?)n).ToArray());
        return new JsonObject { ["seq"] = seq, ["error"] = new JsonObject { ["kind"] = "idle", ["apps"] = apps } };
    }

    /** "Spotify", "Apple Music", "Google Chrome" ... from a session's app ID. */
    string AppName(string id)
    {
        if (names.TryGetValue(id, out var name)) return name;
        // The Start menu's name for the ID (shell:AppsFolder holds packaged and desktop apps alike),
        // as WinRT's AppInfo.GetFromAppUserModelId gives it -- which would need a projection of most of
        // Windows.ApplicationModel and Windows.Storage.
        name = null;
        // An empty ID would name shell:AppsFolder itself ("Applications").
        if (id.Length > 0 && SHCreateItemFromParsingName(@"shell:AppsFolder\" + id, IntPtr.Zero, typeof(IShellItem).GUID, out var item) == 0)
        {
            if (item.GetDisplayName(0 /* SIGDN_NORMALDISPLAY */, out var text) == 0)
            {
                name = Marshal.PtrToStringUni(text);
                Marshal.FreeCoTaskMem(text);
            }
            Marshal.ReleaseComObject(item);
        }
        if (string.IsNullOrEmpty(name))
        {
            name = id.Split('!')[0];                            // Publisher.App_hash!App → Publisher.App_hash
            if (name.Contains('_')) name = name[..name.LastIndexOf('_')];
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
            name = name.Split('.').Last();                       // SpotifyAB.SpotifyMusic → SpotifyMusic
        }
        return names[id] = name;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, [MarshalAs(UnmanagedType.LPStruct)] Guid iid, out IShellItem item);

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem
    {
        void BindToHandler();                                   // unused slots keep the vtable order
        void GetParent();
        [PreserveSig] int GetDisplayName(int sigdn, out IntPtr name);
    }

    /** The cover as a small JPEG data URL; the bar shows it at 64 px. */
    static async Task<string?> Thumbnail(IRandomAccessStreamReference? reference)
    {
        if (reference == null) return null;
        try
        {
            using var input = await reference.OpenReadAsync().AsTask().WaitAsync(CallTimeout);
            var decoder = await BitmapDecoder.CreateAsync(input);
            var scale = Math.Min(1, 128.0 / Math.Min(decoder.PixelWidth, decoder.PixelHeight));
            using var output = new InMemoryRandomAccessStream();
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, output);
            using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore);
            encoder.SetSoftwareBitmap(bitmap);
            encoder.BitmapTransform.ScaledWidth = (uint)Math.Max(1, Math.Round(decoder.PixelWidth * scale));
            encoder.BitmapTransform.ScaledHeight = (uint)Math.Max(1, Math.Round(decoder.PixelHeight * scale));
            encoder.BitmapTransform.InterpolationMode = BitmapInterpolationMode.Fant;
            await encoder.FlushAsync();
            var bytes = new byte[output.Size];
            using var reader = new DataReader(output.GetInputStreamAt(0));
            await reader.LoadAsync((uint)output.Size);
            reader.ReadBytes(bytes);
            return "data:image/jpeg;base64," + Convert.ToBase64String(bytes);
        }
        catch (Exception e)
        {
            Program.Log($"thumbnail: {e.Message}");
            return null;
        }
    }
}

// MARK: - Window

sealed class MainForm : Form
{
    /** JIZURA's aspects (`J.designSize`, app.js `ASPECTS`): a window of one of these shapes has no letterbox. */
    static readonly double[] Aspects = [16.0 / 9, 9.0 / 16, 4.0 / 3, 3.0 / 4, 1, 4.0 / 5, 21.0 / 9];
    static readonly string Origin = $"https://{Program.Host}/";
    static readonly string BoundsFile = Path.Combine(Program.DataDir, "window.json");

    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    readonly PlayerBridge bridge;
    Rectangle? resizeStart;
    bool fullScreen;
    Rectangle beforeFullScreen;
    bool maximizedBeforeFullScreen;

    public MainForm()
    {
        Text = "jizura-sync";
        BackColor = Color.Black;
        StartPosition = FormStartPosition.Manual;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        Controls.Add(web);
        bridge = new PlayerBridge(json => web.CoreWebView2?.PostWebMessageAsJson(json));
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern IntPtr PostMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, WM_NCLBUTTONDOWN = 0xA1, HTCAPTION = 2;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1;
        DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var border = Size - ClientSize;
        MinimumSize = new Size(LogicalToDeviceUnits(320), LogicalToDeviceUnits(320)) + border;
        if (LoadBounds() is { } saved)
        {
            Bounds = saved;
            Snap(null);                 // a size saved before snapping existed
        }
        else
        {
            ClientSize = new Size(LogicalToDeviceUnits(1280), LogicalToDeviceUnits(720));
            CenterToScreen();
        }

        var root = Environment.GetEnvironmentVariable("JIZURA_WEB_ROOT") is { Length: > 0 } dir ? Path.GetFullPath(dir)
            : Path.Combine(AppContext.BaseDirectory, "web");
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "WebView2"));
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"WebView2 could not start: {ex.Message}\n\nInstall the WebView2 Runtime from https://developer.microsoft.com/microsoft-edge/webview2/",
                            "jizura-sync", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }
        var core = web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.SetVirtualHostNameToFolderMapping(Program.Host, root, CoreWebView2HostResourceAccessKind.Deny);
        core.WebMessageReceived += OnMessage;
        core.NavigationCompleted += (_, _) => PostFullScreen();     // a reload (F5) in full screen
        // Links that leave the page (target=_blank, or any navigation off the page's origin) open in
        // the browser; only http(s), so nothing the page links to can open a file or another app.
        core.NewWindowRequested += (_, args) => { args.Handled = true; OpenExternal(args.Uri); };
        core.NavigationStarting += (_, args) =>
        {
            if (args.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
            args.Cancel = true;
            OpenExternal(args.Uri);
        };

        var query = Environment.GetEnvironmentVariable("JIZURA_QUERY") is { Length: > 0 } q ? "?" + Uri.EscapeDataString(q).Replace("%3D", "=").Replace("%26", "&") : "";
        core.Navigate($"{Origin}index.html{query}");
    }

    static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var url) || (url.Scheme != "http" && url.Scheme != "https")) return;
        Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
    }

    // Page → native: { cmd: 'start' }, { cmd: 'dragWindow' }, { cmd: 'fullscreen', on } or a player command (see PlayerBridge.Command)
    void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
        JsonNode? body;
        try { body = JsonNode.Parse(e.WebMessageAsJson); } catch (JsonException) { return; }
        if (body is not JsonObject || (string?)body["cmd"] is not { } cmd) return;
        switch (cmd)
        {
            case "start": bridge.Start(); break;
            case "dragWindow":
                if (fullScreen || WindowState != FormWindowState.Normal) return;
                // The page saw the press move; hand the rest of the drag to Windows' own move loop.
                GetCursorPos(out var p);
                ReleaseCapture();
                PostMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, (IntPtr)((p.Y << 16) | (p.X & 0xFFFF)));
                break;
            case "fullscreen": SetFullScreen((bool?)body["on"] == true); break;
            case "play" or "pause" or "next" or "previous" or "seek": bridge.Command(cmd, body); break;
            case "http": Fetch((JsonObject)body); break;
        }
    }

    /** Lyric catalogues the page may reach through Fetch: ones that send no CORS headers (web/lyrics.js). */
    static readonly HashSet<string> HttpHosts = ["music.163.com"];
    static readonly HttpClient http = CreateHttpClient();

    static HttpClient CreateHttpClient()
    {
        // No redirects: HttpHosts is checked on the URL the page asked for, and a redirect would lead past it.
        var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10), MaxResponseContentBufferSize = 4 << 20 };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36");
        return client;
    }

    /**
     * Page → native `{cmd: 'http', id, url, form?}` (native.js `nativeHttp`): GET, or POST `form` as
     * application/x-www-form-urlencoded, to an https host in HttpHosts, so the page is no general
     * proxy. Answers `{http: id, status, body}` or `{http: id, error: host | timeout | network}` --
     * an error kind, never a sentence, like the readings. Awaited on the UI thread, so the answer is
     * posted from it.
     */
    async void Fetch(JsonObject body)
    {
        var answer = new JsonObject { ["http"] = body["id"]?.DeepClone() };
        var target = body["url"]?.ToString();
        try
        {
            if (!Uri.TryCreate(target, UriKind.Absolute, out var url) || url.Scheme != "https" || !HttpHosts.Contains(url.Host))
            {
                answer["error"] = "host";
                Program.Log($"http {target} refused: host not allowed");
            }
            else
            {
                using var request = new HttpRequestMessage(body["form"] is JsonObject ? HttpMethod.Post : HttpMethod.Get, url);
                if (body["form"] is JsonObject form)
                    request.Content = new FormUrlEncodedContent(form.Select(kv => KeyValuePair.Create(kv.Key, kv.Value?.ToString() ?? "")));
                request.Headers.Referrer = new Uri($"https://{url.Host}/");
                using var response = await http.SendAsync(request);
                answer["status"] = (int)response.StatusCode;
                answer["body"] = await response.Content.ReadAsStringAsync();
                Program.Log($"http {request.Method} {url} {(int)response.StatusCode}");
            }
        }
        catch (Exception e)
        {
            answer["error"] = e is TaskCanceledException ? "timeout" : "network";
            Program.Log($"http {target} failed: {e.Message}");
        }
        // The window may have closed during the request; an exception here would end the process (async void).
        if (IsDisposed || web.IsDisposed) return;
        try { web.CoreWebView2?.PostWebMessageAsJson(answer.ToJsonString()); }
        catch (Exception e) when (e is InvalidOperationException or ObjectDisposedException) { Program.Log($"http {target} answer dropped: {e.Message}"); }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        bridge.Visible = WindowState != FormWindowState.Minimized;
    }

    protected override void OnResizeBegin(EventArgs e)
    {
        base.OnResizeBegin(e);
        resizeStart = Bounds;
    }

    /** Resizing is free while dragging; on release the window settles on the nearest JIZURA aspect. */
    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e);
        var start = resizeStart;
        resizeStart = null;
        if (start?.Size != Size) Snap(start);     // a move also ends here
    }

    /**
     * Reshapes the window to the nearest JIZURA aspect, keeping its area. On each axis the edge
     * the drag left alone stays put; an axis whose edges both stayed (a drag on the other axis's
     * edge) keeps its centre.
     */
    void Snap(Rectangle? start)
    {
        if (fullScreen || WindowState != FormWindowState.Normal) return;
        var old = Bounds;
        var client = ClientSize;
        if (client.Width <= 0 || client.Height <= 0) return;
        var ratio = (double)client.Width / client.Height;
        var aspect = Aspects.MinBy(a => Math.Abs(Math.Log(ratio / a)));
        var area = (double)client.Width * client.Height;
        double w = Math.Sqrt(area * aspect), h = Math.Sqrt(area / aspect);
        // Near the minimum size the same area would put one side below it: grow instead of distorting.
        var min = MinimumSize - (Size - client);
        var grow = Math.Max(1, Math.Max(min.Width / w, min.Height / h));
        var size = new Size((int)Math.Round(w * grow), (int)Math.Round(h * grow));
        if (size == client) return;
        var frame = size + (old.Size - client);
        var s = start ?? old;
        static int Edge(int lo, int hi, int startLo, int startHi, int length)
        {
            bool loMoved = lo != startLo, hiMoved = hi != startHi;
            if (hiMoved && !loMoved) return lo;              // dragged the right / bottom edge
            if (loMoved && !hiMoved) return hi - length;     // dragged the left / top edge
            return (lo + hi) / 2 - length / 2;
        }
        var bounds = new Rectangle(Edge(old.Left, old.Right, s.Left, s.Right, frame.Width),
                                   Edge(old.Top, old.Bottom, s.Top, s.Bottom, frame.Height), frame.Width, frame.Height);
        // Keep it on screen where it fits.
        var screen = Screen.FromRectangle(bounds).WorkingArea;
        if (bounds.Width <= screen.Width) bounds.X = Math.Clamp(bounds.X, screen.Left, screen.Right - bounds.Width);
        if (bounds.Height <= screen.Height) bounds.Y = Math.Clamp(bounds.Y, screen.Top, screen.Bottom - bounds.Height);
        Bounds = bounds;
    }

    /**
     * The page asked for full screen (F, double-click, the button; Esc to leave): cover the whole
     * monitor. Not HTML fullscreen, where WebView2 takes Esc before the page sees it (native.js
     * setHostFullscreen).
     */
    void SetFullScreen(bool on)
    {
        if (on == fullScreen) return;
        fullScreen = on;
        PostFullScreen();
        if (on)
        {
            maximizedBeforeFullScreen = WindowState == FormWindowState.Maximized;
            beforeFullScreen = maximizedBeforeFullScreen ? RestoreBounds : Bounds;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = beforeFullScreen;
            if (maximizedBeforeFullScreen) WindowState = FormWindowState.Maximized;
        }
    }

    void PostFullScreen() => web.CoreWebView2?.PostWebMessageAsJson(fullScreen ? """{"fullscreen":true}""" : """{"fullscreen":false}""");

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        var bounds = fullScreen ? beforeFullScreen : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        try
        {
            Directory.CreateDirectory(Program.DataDir);
            File.WriteAllText(BoundsFile, JsonSerializer.Serialize(new[] { bounds.X, bounds.Y, bounds.Width, bounds.Height }));
        }
        catch (IOException) { }
    }

    /** The bounds saved last, if they are still on a screen. */
    static Rectangle? LoadBounds()
    {
        try
        {
            var b = JsonSerializer.Deserialize<int[]>(File.ReadAllText(BoundsFile));
            if (b is not { Length: 4 }) return null;
            var r = new Rectangle(b[0], b[1], b[2], b[3]);
            return Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)) ? r : null;
        }
        catch (Exception) { return null; }
    }
}
