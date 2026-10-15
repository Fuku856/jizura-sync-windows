// jizura-sync: follow what the signed-in Spotify account is playing (on any device) and
// render it as a JIZURA lyric motion in real time.
//
// JIZURA's renderer is a pure function of time -- `frame(ctx, plan, t)` draws the instant `t`
// of a plan built once per song -- so syncing is just handing it the interpolated playback
// position every animation frame. Seeks, pauses and track skips need no extra state.

import { auth, SpotifyPlayer } from './spotify.js';
import { fetchLyrics, lrcToJizura } from './lyrics.js';
import { hasNative, isWindows, NativePlayer } from './native.js';
import { t, localizePage } from './i18n.js';

localizePage();          // before anything below reads or replaces the page's text

const J = window.J;

const $ = (id) => document.getElementById(id);
const canvas = $('view');
// What every animation frame touches.
const el = { notice: $('notice'), bar: $('bar'), playPause: $('playPause'), elapsed: $('elapsed'), total: $('total'), seek: $('seek') };
// Opaque: JIZURA paints the whole background every frame, and a cleared canvas is the page's black.
const ctx = canvas.getContext('2d', { alpha: false });

// Bumped when a web font arrives: everything drawn before it may show a fallback face.
let fontGen = 0;

/**
 * A cut-to-cut transition composites the previous cut's resting frame, which JIZURA draws again
 * into `transA` on every frame of the transition -- always at the same time, so always the same
 * picture. Transitions only read `transA`, so the picture from the last call is kept.
 */
class SyncRenderer extends J.Renderer {
    frame(ctx, plan, t, opt = {}) {
        if (ctx.canvas !== this.transA || !opt.noTrans || !opt.noPost || !opt.noHud) return super.frame(ctx, plan, t, opt);
        const key = [plan, t, ctx.canvas.width, ctx.canvas.height, opt.scale, !!opt.fast, !!opt.noGhost, fontGen];
        if (this.restKey?.every((v, i) => v === key[i])) return;
        super.frame(ctx, plan, t, opt);
        this.restKey = key;
    }
}
const renderer = new SyncRenderer();

// Characters JIZURA's HUD / title cards draw besides the lyrics (same set as its editor UI).
const HUD_CHARS = '0123456789:./-_()【】・No.LYRICRECUNTITLEDXYlinebpminterlude—─／ ';
const ASPECTS = ['16:9', '9:16', '4:3', '3:4', '1:1', '4:5', '21:9'];
// A song with no lyrics (yet) is a title card over one interlude cut. `[間奏]` is JIZURA's own
// lyric syntax for an instrumental break.
const NO_LYRICS = '[00:00.50][間奏]';

const OFFSET_KEY = 'jizura-sync.offsetMs';
const OFFSET_STEP_MS = 50;
// Frame stepping: JIZURA quantises motion to `koma` drawings per second (0 = every output
// frame) and its random look picks the value per mood. null = keep that pick.
const KOMA_KEY = 'jizura-sync.koma';
const KOMA_CYCLE = [null, 0, 12, 8];
// JIZURA's `unify`: per-part palettes of layouts / motions, repeated lines shown the same way,
// accent ("kime") lines. JIZURA defaults it off and its random look never sets it; without it
// every cut is an independent draw, which reads as random. On by default here.
const UNIFY_KEY = 'jizura-sync.unify';
// The now-playing bar is shown until the user clicks it away; the choice sticks.
const BAR_KEY = 'jizura-sync.barHidden';

let player = null;
let trackId = null;          // track the current plan belongs to
let artUrl = null;           // cover the bar shows
let song = null;             // { title, artist, durationMs, lyrics } for the current track
let look = null;             // JIZURA random look (omakase) applied on top of the default project
let plan = null;
let planAspect = null;       // JIZURA aspect key ('16:9' …) the plan was built for
let loadToken = 0;
let offsetMs = Number(read(OFFSET_KEY)) || 0;
let komaPref = read(KOMA_KEY) === null ? null : Number(read(KOMA_KEY));
let unifyPref = read(UNIFY_KEY) !== '0';
let barHidden = read(BAR_KEY) === '1';

// ---------------------------------------------------------------- project / plan

function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
}

/** The supported JIZURA aspect closest to the window's, so the frame fills the screen. */
function windowAspect() {
    const r = window.innerWidth / Math.max(1, window.innerHeight);
    let best = ASPECTS[0], bd = Infinity;
    for (const a of ASPECTS) {
        const [w, h] = a.split(':').map(Number);
        const d = Math.abs(Math.log(r / (w / h)));
        if (d < bd) { bd = d; best = a; }
    }
    return best;
}

/** A fresh random look. Seeded by the track for the first roll, so a song always opens the same way. */
function rollLook(seed) {
    const rnd = seed == null ? Math.random : J.rng(seed);
    const base = Object.assign(J.defaultProject(), { extra: true, typo: true, kinetic: true });
    return J.omakase(base, rnd);
}

function buildPlan() {
    if (!song) { plan = null; return; }
    const project = Object.assign(J.defaultProject(), {
        extra: true, typo: true, kinetic: true, horror: false,
        title: song.title, artist: song.artist, lyrics: song.lyrics,
        aspect: (planAspect = windowAspect()), fps: 60,
    }, look);
    project.unify = unifyPref;
    if (komaPref !== null) project.fx = Object.assign({}, project.fx, { koma: komaPref, onTwos: komaPref > 0 });
    // LRC times are the whole timing: no BPM grid to snap to.
    project.timing = Object.assign({}, project.timing, { bpm: 0, snap: false });
    project.enabled = Object.assign({}, J.defaultProject().enabled, look.enabled);
    plan = J.plan(project, song.durationMs ? { duration: song.durationMs / 1000 } : null);
    pace.settleUntil = performance.now() + SETTLE_MS;
    sizeCanvas();
    J.ensureFonts(song.lyrics + song.title + song.artist + HUD_CHARS, J.fontsOfPlan(plan)).catch(() => {});
    setStatus(`${J.STYLES[project.style]?.name ?? project.style} · ${J.MOODS[project.mood]?.name ?? ''} · ${t('{n} cuts', { n: plan.cuts.length })}${project.unify ? ` · ${t('same style per section')}` : ''}`);
}

async function loadTrack(state) {
    const token = ++loadToken;
    pace.upWait = UP_WAIT_MS;        // another song may not have the cuts that held the level down
    trackId = state.trackId;
    $('track').textContent = `${state.title} — ${state.artist}`;
    showArt(state.artUrl);
    $('notice').hidden = true;
    look = rollLook(hashString(state.trackId));
    song = { title: state.title, artist: state.artist, durationMs: state.durationMs, lyrics: NO_LYRICS };
    buildPlan();
    setStatus(t('Looking up lyrics…'));
    let lyr = null;
    try {
        lyr = await fetchLyrics({ artist: state.artist, title: state.title, album: state.album, durationMs: state.durationMs });
    } catch (err) {
        if (token !== loadToken) return;
        console.warn('lyrics', err);
        setStatus(t('Lyrics lookup failed: {detail}', { detail: err.message }));    // the notice says it; no toast
        showNotice(t('No lyrics: lookup failed ({detail})', { detail: err.message }));
        return;
    }
    if (token !== loadToken) return;
    if (!lyr || !lyr.synced) {
        const why = t(lyr?.instrumental ? 'Instrumental' : lyr ? 'No synced lyrics for this track' : 'No lyrics found for this track');
        setStatus(why);
        showNotice(why);
        return;
    }
    const { lyrics, lines, parts } = lrcToJizura(lyr.synced);
    song = Object.assign({}, song, { lyrics });
    buildPlan();
    console.info(`[jizura-sync] ${state.title}: ${lines} lines in ${parts} parts`);
}

/**
 * A radio station or live stream: its position is not a place in a song, so there is nothing to
 * time lyrics against. Show what is playing and say so.
 */
function loadStream(state) {
    ++loadToken;                    // a lookup still running for the previous song is dropped
    trackId = state.trackId;
    song = null; plan = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    $('track').textContent = [state.title, state.artist].filter(Boolean).join(' — ');
    showArt(state.artUrl);
    const why = t('No lyrics: a stream has no song position to time them to');
    setStatus(why);
    showNotice(why);
}

/** A player may send the cover after the title (a browser fetches the artwork later), so it follows each state. */
function showArt(url = null) {
    if (url === artUrl) return;
    artUrl = url;
    $('art').hidden = !url;
    if (url) $('art').src = url;
}

// ---------------------------------------------------------------- quality

// Some JIZURA cuts cost far more than a frame -- a layout with a hundred glyphs is drawn three
// times over for the chromatic ghosts. While frames come late the look steps down one level at a
// time, and steps back up once frames have kept time for a while. Measured on a Radeon 780M at
// 1440 px, a `cylinder` cut ran at 18 fps at level 0 and 68 fps at level 4.
const QUALITY = [
    { fast: false, scale: 1, ghost: true, fps: 0 },          // as JIZURA draws it (fps 0: the plan's)
    { fast: true, scale: 1, ghost: true, fps: 0 },           // no blur filters or bloom
    { fast: true, scale: 0.75, ghost: true, fps: 0 },        // fewer pixels
    { fast: true, scale: 0.75, ghost: false, fps: 0 },       // no chromatic ghost passes
    { fast: true, scale: 0.5, ghost: false, fps: 0 },
    { fast: true, scale: 0.5, ghost: false, fps: 30 },
];
const LATE_WINDOW = 12;      // recent frames looked at for a step down …
const LATE_LIMIT = 4;        // … and how many of them may be late
const UP_WAIT_MS = 3000;     // no late frame for this long before a step up
const UP_WAIT_MAX_MS = 30000;
const STEP_DOWN_MS = 500;    // a level gets this long to show what it does before the next step down
// After a new plan or a font, frames build caches (text layout, glyph samples, glyph masks) and run
// long for a moment however fast the machine is: not judged.
const SETTLE_MS = 1500;

// `?quality=<level>` keeps one level (for comparing them).
const qualityPin = (() => {
    const q = new URLSearchParams(location.search).get('quality');
    return q === null || q === '' || !Number.isFinite(Number(q)) ? null : Math.min(QUALITY.length - 1, Math.max(0, Math.round(Number(q))));
})();
let quality = qualityPin ?? 0;
const pace = {
    last: 0,                 // previous animation frame
    drew: false,             // … drew a frame that is to be judged
    base: 1000 / 60,         // the display's frame interval (smallest seen, creeping up slowly)
    recent: [],              // late or not, for the last LATE_WINDOW judged frames
    since: 0,                // the level last changed
    calm: 0,                 // no late frame since
    raisedAt: -Infinity, upWait: UP_WAIT_MS,
    settleUntil: 0,
    drawMs: 0, lateRate: 0,  // running averages for `jizuraSync.perf`
};

function setQuality(level, now) {
    if (level === quality) return;
    // A step up that is taken back at once waits twice as long before the next try.
    if (level > quality && now - pace.raisedAt < UP_WAIT_MS) pace.upWait = Math.min(UP_WAIT_MAX_MS, pace.upWait * 2);
    if (level < quality) pace.raisedAt = now;
    quality = level;
    pace.recent.length = 0;
    pace.since = pace.calm = now;
    sizeCanvas();
    console.info(`[jizura-sync] quality ${quality}`);
}

/** Judges the frame drawn by the previous animation frame by when this one came. */
function judgeFrame(now) {
    const interval = now - pace.last, drew = pace.drew;
    pace.last = now; pace.drew = false;
    if (interval > 0) pace.base = Math.min(interval, pace.base + 0.01);
    // Over a second: hidden, minimized or stopped in a debugger, not slow.
    if (!drew || interval > 1000 || now < pace.settleUntil) return;
    const due = Math.max(pace.base, 1000 / (QUALITY[quality].fps || plan?.fps || 60));
    const late = interval > due * 1.5;
    pace.lateRate += ((late ? 1 : 0) - pace.lateRate) * 0.02;
    if (qualityPin !== null) return;
    pace.recent.push(late);
    if (pace.recent.length > LATE_WINDOW) pace.recent.shift();
    if (late) pace.calm = now;
    if (quality < QUALITY.length - 1 && now - pace.since >= STEP_DOWN_MS && pace.recent.filter(Boolean).length >= LATE_LIMIT) setQuality(quality + 1, now);
    else if (quality > 0 && now - pace.calm >= pace.upWait) setQuality(quality - 1, now);
}
document.addEventListener('visibilitychange', () => { pace.recent.length = 0; pace.drew = false; });

// ---------------------------------------------------------------- drawing

function sizeCanvas() {
    if (!plan) return;
    const ar = plan.W / plan.H;
    let cssW = window.innerWidth, cssH = cssW / ar;
    if (cssH > window.innerHeight) { cssH = window.innerHeight; cssW = cssH * ar; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(Math.min(plan.W, cssW * dpr) * QUALITY[quality].scale), ph = Math.round(pw / ar);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
}

// What the canvas shows. A frame depends only on the plan, the time, the canvas size, the quality
// level and the loaded fonts, so one that would repeat it (paused, or a display faster than the
// plan's frame rate) is skipped; a font arriving redraws.
let drawn = null;
document.fonts.addEventListener('loadingdone', () => { drawn = null; fontGen++; pace.settleUntil = performance.now() + SETTLE_MS; });

function tick(now) {
    requestAnimationFrame(tick);
    judgeFrame(now);
    const state = player?.getState();
    if (state && state.trackId && state.trackId !== trackId) (state.durationMs > 0 ? loadTrack(state) : loadStream(state));
    else if (state?.trackId === trackId) showArt(state.artUrl);
    if (state) lastError = null;
    updateBar(state);
    // The notice belongs to the song it was shown for: gone once that song is.
    if ((!state || state.trackId !== trackId) && !el.notice.hidden) el.notice.hidden = true;
    if (!plan || !state || state.trackId !== trackId) return;
    // On the plan's frame grid, as JIZURA renders a video: a faster display adds no new pictures.
    const Q = QUALITY[quality], fps = Q.fps || plan.fps || 60;
    const time = Math.min(Math.floor(Math.max(0, (state.positionMs + offsetMs) / 1000) * fps + 1e-6) / fps, plan.duration - 1e-3);
    if (drawn && drawn.plan === plan && drawn.time === time && drawn.w === canvas.width && drawn.h === canvas.height && drawn.quality === quality) return;
    // The first frame of a cut lays out its text and builds its caches, which no level makes cheaper.
    const cut = J.cutAt(plan, time);
    pace.drew = !!drawn && drawn.plan === plan && drawn.cut === cut;
    drawn = { plan, time, w: canvas.width, h: canvas.height, quality, cut };
    const t0 = performance.now();
    renderer.frame(ctx, plan, time, { scale: canvas.width / plan.W, fast: Q.fast, noGhost: !Q.ghost });
    pace.drawMs += (performance.now() - t0 - pace.drawMs) * 0.05;
}

// ---------------------------------------------------------------- Spotify

function startPlayer() {
    $('gate').hidden = true;
    $('disconnect').hidden = false;
    showBar();
    player = new SpotifyPlayer();
    player.onError((err) => {
        if (err.kind === 'not-registered') {
            showGate(t('This Spotify account is not on your app’s User Management list. Add it in the Spotify dashboard and reload — or sign out of Spotify and connect with the right account.'));
            return;
        }
        if (err.kind === 'auth') { showGate(t('{detail}. Connect again.', { detail: err.message })); return; }
        showError(err.message);
    });
    player.start();
}

/** The gate is the only non-playing screen: set up the client ID, connect, or explain a failure. */
function showGate(text) {
    player?.stop();
    $('notice').hidden = true;
    player = null;
    $('gateText').textContent = text;
    const configured = !!auth.clientId();
    $('setup').hidden = configured;
    $('connect').hidden = !configured;
    $('changeClient').hidden = !configured;
    $('bar').hidden = true;
    $('help').hidden = true;
    $('redirectUri').textContent = auth.redirectUri();
    $('clientId').value = auth.clientId() || '';
    $('gate').hidden = false;
}

$('setup').addEventListener('submit', (e) => {
    e.preventDefault();
    auth.setClientId($('clientId').value);
    showGate(t('Client ID saved. Connect to sign in with Spotify.'));
});
$('connect').addEventListener('click', () => {
    auth.begin().catch((err) => showGate(t('Could not start Spotify sign-in: {detail}', { detail: err.message })));
});
$('changeClient').addEventListener('click', () => {
    $('setup').hidden = false;
    $('connect').hidden = true;
    $('changeClient').hidden = true;
});
// Forgets this page's tokens. Spotify keeps its own session cookie, so signing in as another
// account also needs a sign-out at accounts.spotify.com.
$('disconnect').addEventListener('click', () => {
    auth.disconnect();
    $('help').hidden = true;
    trackId = null; song = null; plan = null;
    $('notice').hidden = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    showGate(t('Disconnected. Access can also be removed at spotify.com/account/apps.'));
});

// ---------------------------------------------------------------- controls

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) {
    try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

/** Why nothing is being sung on screen: shown on top of the title card until the next track. */
function showNotice(text) {
    $('notice').textContent = text;
    $('notice').hidden = false;
}

function setStatus(text) { $('status').textContent = text; wake(); }
function togglePlay() { if (player) (player.isPlaying() ? player.pause() : player.play()); }

// Errors also reach a user who hid the bar: a toast outside it, once per distinct message
// while nothing plays (a missing device reports every 3 s).
let lastError = null, toastTimer = 0;
function showError(text) {
    setStatus(text);
    if (!barHidden || $('bar').hidden || text === lastError) return;
    lastError = text;
    $('toast').textContent = text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function setOffset(ms) {
    offsetMs = ms;
    write(OFFSET_KEY, String(ms));
    setStatus(ms === 0 ? t('Lyrics timing reset') : t(ms > 0 ? 'Lyrics {ms} ms earlier' : 'Lyrics {ms} ms later', { ms: Math.abs(ms) }));
}
function toggleUnify() {
    unifyPref = !unifyPref;
    write(UNIFY_KEY, unifyPref ? '1' : '0');
    if (song) buildPlan();
    setStatus(t(unifyPref ? 'Same style within each song section' : 'Every line styled independently'));
}
function cycleKoma() {
    komaPref = KOMA_CYCLE[(KOMA_CYCLE.indexOf(komaPref) + 1) % KOMA_CYCLE.length];
    write(KOMA_KEY, komaPref === null ? null : String(komaPref));
    if (song) buildPlan();
    setStatus(komaPref === null ? t('Motion: as the look picks') : komaPref === 0 ? t('Motion: smooth') : t('Motion: choppy, {fps} fps', { fps: komaPref }));
}
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
}

/** One control, by its key name. Keys and the help window's buttons (no keyboard in a car) share it. */
function runKey(key) {
    switch (String(key).toLowerCase()) {
        case 'r':
            if (!song) return false;
            look = rollLook(null);
            buildPlan();
            break;
        case 'k': cycleKoma(); break;
        case 'u': toggleUnify(); break;
        case '[': setOffset(offsetMs - OFFSET_STEP_MS); break;
        case ']': setOffset(offsetMs + OFFSET_STEP_MS); break;
        case ' ': togglePlay(); break;
        case 'f': toggleFullscreen(); break;
        case 'h': toggleBar(); break;
        case '?': $('help').hidden = !$('help').hidden; break;
        case 'escape': $('help').hidden = true; break;
        default: return false;
    }
    wake();
    return true;
}

window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLInputElement && e.target.type !== 'range')) return;
    if (runKey(e.key) && e.key === ' ') e.preventDefault();
});
// A car's browser has a touchscreen and no keyboard, so there every key in the help becomes a
// button. Tesla's user agent ends in `Tesla/<version>`; `?tesla` does the same anywhere.
if (/\bTesla\//.test(navigator.userAgent) || new URLSearchParams(location.search).has('tesla')) {
    document.body.classList.add('tap-keys');
    $('help').querySelectorAll('kbd').forEach((kbd) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'key';
        kbd.replaceWith(b);
        b.append(kbd);
        // blur: a focused button would repeat on Enter / Space where a keyboard exists (?tesla).
        b.addEventListener('click', () => { b.blur(); runKey(kbd.textContent === 'Space' ? ' ' : kbd.textContent); });
    });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('Tap a key to use it.');
    $('help').querySelector('h2').after(hint);
}
window.addEventListener('dblclick', (e) => { if (!e.target.closest('#bar, #gate, #help')) toggleFullscreen(); });

let resizeTimer = 0;
window.addEventListener('resize', () => {
    sizeCanvas();
    // A different window shape may want a different JIZURA aspect, which is a new plan.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (song && windowAspect() !== planAspect) buildPlan(); }, 300);
});

let idleTimer = 0;
function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
}
window.addEventListener('pointermove', wake);

// ---------------------------------------------------------------- now-playing bar

function fmtTime(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let seeking = false;         // the slider is being dragged: do not move it under the pointer
function updateBar(state) {
    // Clicked away, it is out of sight: it catches up on the frame it comes back.
    if (el.bar.hidden || barHidden) return;
    el.playPause.classList.toggle('play', !player?.isPlaying());
    if (!state) return;
    const elapsed = fmtTime(state.positionMs), total = fmtTime(state.durationMs);
    if (el.elapsed.textContent !== elapsed && !seeking) el.elapsed.textContent = elapsed;
    if (el.total.textContent !== total) el.total.textContent = total;
    const pos = String(Math.round(1000 * state.positionMs / Math.max(1, state.durationMs)));
    if (!seeking && el.seek.value !== pos) el.seek.value = pos;
}

function showBar() {
    $('bar').hidden = false;
    document.body.classList.toggle('bar-hidden', barHidden);
    $('bar').inert = barHidden;             // hidden controls must not take focus or keys
}
function toggleBar() {
    if ($('bar').hidden) return;
    barHidden = !barHidden;
    write(BAR_KEY, barHidden ? '1' : null);
    $('toast').hidden = true;
    lastError = null;
    document.body.classList.toggle('bar-hidden', barHidden);
    $('bar').inert = barHidden;
}

$('prev').addEventListener('click', () => player?.previous());
$('next').addEventListener('click', () => player?.next());
$('playPause').addEventListener('click', togglePlay);
$('fullscreen').addEventListener('click', toggleFullscreen);
$('helpButton').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
$('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').hidden = true; });
$('seek').addEventListener('input', () => {
    seeking = true;
    const st = player?.getState();
    if (st) $('elapsed').textContent = fmtTime(st.durationMs * $('seek').value / 1000);
});
$('seek').addEventListener('change', () => {
    seeking = false;
    const st = player?.getState();
    if (st) player.seek(st.durationMs * $('seek').value / 1000);
});
// `change` does not fire when a drag ends where it started or is cancelled.
for (const ev of ['pointerup', 'pointercancel', 'blur']) $('seek').addEventListener(ev, () => { seeking = false; });

// A click anywhere outside the bar toggles it. Delayed so that a double click (fullscreen)
// does not flash the bar off and on.
let clickTimer = 0;
window.addEventListener('click', (e) => {
    if (e.target.closest('#bar, #gate, #help, #toast')) return;
    clearTimeout(clickTimer);
    if (e.detail > 1) return;
    clickTimer = setTimeout(toggleBar, 250);
});

// ---------------------------------------------------------------- boot

/**
 * `?mock` (or `?mock=Artist|Title|durationMs`): no Spotify -- a fixed track on a local clock,
 * for trying the lyrics and rendering without an account. `?t=<seconds>` starts there.
 */
class MockPlayer {
    constructor(spec, startS) {
        const [artist, title, dur] = (spec || 'YOASOBI|夜に駆ける|261000').split('|');
        this.track = { trackId: `mock:${artist}:${title}`, artist, title, album: null, durationMs: Number(dur) || 261000 };
        this.base = startS * 1000;
        this.t0 = performance.now();
        this.paused = false;
    }
    getState() {
        const pos = this.paused ? this.base : this.base + performance.now() - this.t0;
        return { ...this.track, positionMs: pos % this.track.durationMs, paused: this.paused };
    }
    play() { if (this.paused) { this.t0 = performance.now(); this.paused = false; } }
    pause() { if (!this.paused) { this.base = this.getState().positionMs; this.paused = true; } }
    seek(ms) { this.base = ms; this.t0 = performance.now(); }
    isPlaying() { return !this.paused; }
    previous() { this.seek(0); }
    next() {}
    stop() {}
}

/**
 * The app window moves by a drag anywhere except the controls. On macOS the app takes the mouse
 * itself and is told where the controls are; on Windows the page sees the mouse first, and asks
 * the app to move the window once a press outside them has moved, so a click stays a click.
 */
function watchDrag(native) {
    if (isWindows()) {
        let down = null;
        window.addEventListener('pointerdown', (e) => {
            down = e.button === 0 && !document.fullscreenElement && !e.target.closest('#bar, #help, #gate, #toast') ? [e.screenX, e.screenY] : null;
        });
        window.addEventListener('pointermove', (e) => {
            if (!down || !(e.buttons & 1)) { down = null; return; }
            if (Math.hypot(e.screenX - down[0], e.screenY - down[1]) > 3) { down = null; native.dragWindow(); }
        });
        window.addEventListener('pointerup', () => { down = null; });
        return;
    }
    let last = '';
    (function check() {
        requestAnimationFrame(check);
        const els = [];
        if (!$('bar').hidden && !barHidden) els.push($('bar'));
        if (!$('help').hidden) els.push($('help'));
        const rects = els.map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
        const key = JSON.stringify(rects);
        if (key !== last) { last = key; native.setNoDrag(rects); }
    })();
}

async function boot() {
    requestAnimationFrame(tick);
    wake();
    const q = new URLSearchParams(location.search);
    if (q.has('mock')) { player = new MockPlayer(q.get('mock'), Number(q.get('t')) || 0); showBar(); return; }
    // Inside the macOS or Windows app: the players on this computer, no sign-in.
    if (hasNative()) {
        player = new NativePlayer();
        // A failed read is retried; once it succeeds, the bar goes back to what it said before.
        let beforeError = null;
        player.onError((err) => { beforeError ??= $('status').textContent; showError(err.message); });
        player.onRecover(() => { if (beforeError !== null) setStatus(beforeError); beforeError = null; });
        player.start();
        showBar();
        watchDrag(player);
        return;
    }
    try { await auth.handleRedirect(); } catch (err) { showGate(err.message); return; }
    if (!auth.clientId()) { showGate(t('Paste the Client ID of your own Spotify app to start.')); return; }
    if (!auth.isConnected()) { showGate(t("Lyric motion for what's playing on your Spotify")); return; }
    startPlayer();
}

// Read-only debug handle: `jizuraSync.plan` in devtools.
window.jizuraSync = {
    get plan() { return plan; }, get song() { return song; },
    get perf() { return { quality, pinned: qualityPin !== null, canvas: `${canvas.width}x${canvas.height}`, drawMs: +pace.drawMs.toFixed(1), lateRate: +pace.lateRate.toFixed(3), upWaitMs: pace.upWait }; },
};

boot();
