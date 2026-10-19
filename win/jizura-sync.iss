; The Windows installer: build\win\ (tools/build-win.ps1) into one setup.exe. Build it with
; tools/build-installer.ps1, which passes the version:
;
;   ISCC /DAppVersion=1.2.3-beta.1 /DFileVersion=1.2.3 /DOutputName=<name> /O<dir> win\jizura-sync.iss
;
; - Per user, no administrator: {autopf} is %LOCALAPPDATA%\Programs here. The settings and the WebView2
;   profile stay in %LOCALAPPDATA%\jizura-sync (Program.DataDir), outside {app}, so updating or
;   uninstalling never touches them, and a copy run from the old zip shares them.
; - AppId names the installation to Windows: never change it, or the next version installs beside this
;   one instead of over it.
; - The .NET 10 Desktop Runtime and the WebView2 Runtime are fetched from Microsoft when missing. Only
;   the .NET installer needs administrator rights, so only it asks (UAC).

; WizardStyle's "dynamic" (dark mode with Windows') came in 6.6.0. The CI runner's image has 6.7.1.
#if Ver < EncodeVer(6, 6, 0)
  #error Inno Setup 6.6.0 or later is needed
#endif
#ifndef AppVersion
  #error Pass /DAppVersion=<version> (tools/build-installer.ps1 does)
#endif
#ifndef FileVersion
  #define FileVersion AppVersion
#endif
#ifndef OutputName
  #define OutputName "jizura-sync-v" + AppVersion + "-win-x64-setup"
#endif

[Setup]
AppId={{850829E6-A0DF-4CD0-A014-E3D36B56CB08}
AppName=jizura-sync
AppVersion={#AppVersion}
AppPublisher=Fuku856
AppPublisherURL=https://github.com/Fuku856/jizura-sync-windows
AppSupportURL=https://github.com/Fuku856/jizura-sync-windows/issues
AppUpdatesURL=https://github.com/Fuku856/jizura-sync-windows/releases
AppCopyright=Copyright (c) 2026 Saqoosha, Fuku856
VersionInfoVersion={#FileVersion}
DefaultDirName={autopf}\jizura-sync
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 2004, the media session manager's minimum (the csproj's SupportedOSPlatform).
MinVersion=10.0.19041
; Japanese or English by Windows' display language, asking only when it is neither.
ShowLanguageDialog=auto
WizardStyle=modern dynamic
SetupIconFile=app.ico
UninstallDisplayIcon={app}\jizura-sync.exe
UninstallDisplayName=jizura-sync
OutputBaseFilename={#OutputName}
Compression=lzma2/max
SolidCompression=yes

[Languages]
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ja.PrereqsHeading=あわせて Microsoft から取得して入れるもの:
en.PrereqsHeading=Also downloaded from Microsoft and installed:
ja.DotNetName=.NET 10 Desktop Runtime
en.DotNetName=.NET 10 Desktop Runtime
ja.DotNetNote=（管理者の許可を求めます）
en.DotNetNote= (asks for administrator permission)
ja.WebView2Name=WebView2 Runtime
en.WebView2Name=WebView2 Runtime
ja.InstallingPrereq=%1 をインストールしています...
en.InstallingPrereq=Installing %1...
ja.ExitCode=終了コード %1
en.ExitCode=exit code %1
ja.StillMissing=インストール後も見つかりません
en.StillMissing=still not found after installing
ja.PrereqFailed=%1 をインストールできませんでした（%2）。%n%nもう一度「インストール」を押すか、次のページから入れてからこのセットアップを実行し直してください:%n%3
en.PrereqFailed=%1 could not be installed (%2).%n%nPress Install to try again, or install it from the page below and run this setup again:%n%3

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; The page's files are replaced as a whole, so a file an older version had does not linger.
Type: filesandordirs; Name: "{app}\web"

[Files]
Source: "..\build\win\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\jizura-sync"; Filename: "{app}\jizura-sync.exe"
Name: "{autodesktop}\jizura-sync"; Filename: "{app}\jizura-sync.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\jizura-sync.exe"; Description: "{cm:LaunchProgram,jizura-sync}"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  // Microsoft's links to the latest build: a .NET 10 patch release, and the Evergreen bootstrapper.
  DotNetUrl = 'https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe';
  DotNetPage = 'https://dotnet.microsoft.com/download/dotnet/10.0';
  WebView2Url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
  WebView2Page = 'https://developer.microsoft.com/microsoft-edge/webview2/';

var
  DownloadPage: TDownloadWizardPage;
  NeedDotNet, NeedWebView2: Boolean;

// The app is framework-dependent: its apphost looks for the runtime in Program Files\dotnet.
function HasDotNet: Boolean;
var
  F: TFindRec;
begin
  Result := FindFirst(ExpandConstant('{commonpf64}\dotnet\shared\Microsoft.WindowsDesktop.App\10.*'), F);
  if Result then FindClose(F);
end;

function WebView2Version(Root: Integer; const Key: String): String;
begin
  if not RegQueryStringValue(Root, Key, 'pv', Result) then Result := '';
end;

// Microsoft's check: a version under EdgeUpdate\Clients, machine-wide or per user, other than 0.0.0.0.
function HasWebView2: Boolean;
var
  V: String;
begin
  V := WebView2Version(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Guid);
  if (V = '') or (V = '0.0.0.0') then
    V := WebView2Version(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2Guid);
  Result := (V <> '') and (V <> '0.0.0.0');
end;

function InitializeSetup: Boolean;
begin
  NeedDotNet := not HasDotNet;
  NeedWebView2 := not HasWebView2;
  // ISCC /DForceDotNet or /DForceWebView2: act as if it were missing, to try that path on a PC that has it.
#ifdef ForceDotNet
  NeedDotNet := True;
#endif
#ifdef ForceWebView2
  NeedWebView2 := True;
#endif
  Log(Format('Needs .NET 10 Desktop Runtime: %d, WebView2 Runtime: %d', [Ord(NeedDotNet), Ord(NeedWebView2)]));
  Result := True;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), nil);
  DownloadPage.ShowBaseNameInsteadOfUrl := True;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo;
  if MemoTasksInfo <> '' then Result := Result + NewLine + NewLine + MemoTasksInfo;
  if NeedDotNet or NeedWebView2 then begin
    Result := Result + NewLine + NewLine + CustomMessage('PrereqsHeading');
    if NeedDotNet then Result := Result + NewLine + Space + CustomMessage('DotNetName') + CustomMessage('DotNetNote');
    if NeedWebView2 then Result := Result + NewLine + Space + CustomMessage('WebView2Name');
  end;
end;

// Runs the downloaded installer of one runtime and checks that it is there now; False after telling
// the user why not.
function RunPrereq(IsDotNet: Boolean): Boolean;
var
  Name, Why: String;
  Code: Integer;
  Started: Boolean;
begin
  if IsDotNet then Name := CustomMessage('DotNetName') else Name := CustomMessage('WebView2Name');
  DownloadPage.SetText(FmtMessage(CustomMessage('InstallingPrereq'), [Name]), '');
  if IsDotNet then
    Started := ShellExec('runas', ExpandConstant('{tmp}\windowsdesktop-runtime-win-x64.exe'),
      '/install /passive /norestart', '', SW_SHOW, ewWaitUntilTerminated, Code)
  else
    // Per user, without administrator rights, since this setup does not run elevated.
    Started := Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'),
      '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, Code);
  Log(Format('%s: started %d, exit code %d', [Name, Ord(Started), Code]));
  // Whether it is there now decides, not the exit code: the WebView2 bootstrapper answers 0x80040C28
  // when a machine-wide copy exists, .NET's 3010 asks for a restart and 1638 means a newer one is in.
  if IsDotNet then begin
    NeedDotNet := not HasDotNet;
    Result := not NeedDotNet;
  end else begin
    NeedWebView2 := not HasWebView2;
    Result := not NeedWebView2;
  end;
  if Result then Exit;
  if not Started then
    Why := SysErrorMessage(Code) // 1223: the UAC prompt was declined
  else if Code <> 0 then
    Why := FmtMessage(CustomMessage('ExitCode'), [Format('0x%.8x', [Code])])
  else
    Why := CustomMessage('StillMissing');
  if not Result then
    if IsDotNet then
      SuppressibleMsgBox(FmtMessage(CustomMessage('PrereqFailed'), [Name, Why, DotNetPage]), mbCriticalError, MB_OK, IDOK)
    else
      SuppressibleMsgBox(FmtMessage(CustomMessage('PrereqFailed'), [Name, Why, WebView2Page]), mbCriticalError, MB_OK, IDOK);
end;

// After Install on the ready page: download what is missing, then install it. False keeps the wizard
// on the ready page, so Install tries again.
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID <> wpReady) or not (NeedDotNet or NeedWebView2) then Exit;
  DownloadPage.Clear;
  if NeedDotNet then DownloadPage.Add(DotNetUrl, 'windowsdesktop-runtime-win-x64.exe', '');
  if NeedWebView2 then DownloadPage.Add(WebView2Url, 'MicrosoftEdgeWebview2Setup.exe', '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
    except
      if not DownloadPage.AbortedByUser then
        SuppressibleMsgBox(AddPeriod(Format('%s: %s', [DownloadPage.LastBaseNameOrUrl, GetExceptionMessage])),
          mbCriticalError, MB_OK, IDOK);
      Result := False;
    end;
    if Result then begin
      DownloadPage.ProgressBar.Style := npbstMarquee;
      if NeedDotNet then Result := RunPrereq(True);
      if Result and NeedWebView2 then Result := RunPrereq(False);
      DownloadPage.ProgressBar.Style := npbstNormal;
    end;
  finally
    DownloadPage.Hide;
  end;
end;
