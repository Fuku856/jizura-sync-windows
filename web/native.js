// Playback from the desktop apps, with each reading of the player. Same interface as SpotifyPlayer.
// macOS (mac/main.swift) reads the Spotify / Music app and calls `window.jizuraNative.update(state)`;
// Windows (win/Program.cs) reads the system's media sessions and posts the state as a web message.

import { t } from './i18n.js';

/** A reading that disagrees with the running clock by less than this is jitter, not a seek. */
const RESYNC_MS = 120;

const mac = () => window.webkit?.messageHandlers?.jizuraNative;
/** `chrome.webview` exists only inside a WebView2 host, not in Edge itself. */
const windows = () => window.chrome?.webview;

export const hasNative = () => !!(mac() || windows());
export const isWindows = () => !mac() && !!windows();

export class NativePlayer {
    constructor() {
        this._track = null;          // { trackId, title, artist, album, artUrl, durationMs }
        this._playing = false;
        this._anchorPos = 0;         // position (ms) at …
        this._anchorAt = 0;          // … this performance.now()
        this._seq = 0;               // last command sent; readings taken before it are stale
        this._lastError = null;
        this._onError = () => {};
        this._onRecover = () => {};
    }

    onError(cb) { this._onError = cb; }
    /** First good reading after an error. */
    onRecover(cb) { this._onRecover = cb; }

    start() {
        this._onMessage = (e) => this._update(e.data);
        if (isWindows()) windows().addEventListener('message', this._onMessage);
        else window.jizuraNative = { update: (s) => this._update(s) };
        this._post({ cmd: 'start' });
    }

    stop() {
        if (isWindows()) windows().removeEventListener('message', this._onMessage);
        else delete window.jizuraNative;
    }

    /** @returns {{trackId, title, artist, album, artUrl, durationMs, positionMs, paused} | null} */
    getState() {
        if (!this._track) return null;
        const pos = this._anchorPos + (this._playing ? performance.now() - this._anchorAt : 0);
        return { ...this._track, positionMs: Math.max(0, Math.min(pos, this._track.durationMs)), paused: !this._playing };
    }

    isPlaying() { return this._playing; }

    play() { this._post({ cmd: 'play' }); }
    pause() { this._post({ cmd: 'pause' }); }
    next() { this._post({ cmd: 'next' }); }
    previous() { this._post({ cmd: 'previous' }); }
    /** Areas (CSS px: x, y, width, height) where a mouse drag must not move the window. */
    setNoDrag(rects) { this._post({ cmd: 'noDrag', rects }); }
    /** Windows: move the window with the mouse button that is down now. */
    dragWindow() { this._post({ cmd: 'dragWindow' }); }
    seek(ms) {
        ms = Math.max(0, Math.round(ms));
        // Move the local clock now so the lyrics jump with the slider; the next reading confirms.
        if (this._track) { this._anchorPos = ms; this._anchorAt = performance.now(); }
        this._post({ cmd: 'seek', ms });
    }

    _post(msg) {
        if (['play', 'pause', 'next', 'previous', 'seek'].includes(msg.cmd)) msg.seq = ++this._seq;
        (mac() ?? windows()).postMessage(msg);
    }

    _update(s) {
        if (s.seq < this._seq) return;
        if (s.error) {
            s.error.message = errorText(s.error);
            // Nothing to follow, or not allowed to look. A failed read keeps the track: the retry
            // usually succeeds, and dropping it would blank the bar in between.
            if (s.error.kind === 'idle' || s.error.kind === 'permission') {
                this._track = null;
                this._playing = false;
            }
            // Errors repeat on every retry; report each condition once.
            if (s.error.message !== this._lastError) this._onError(s.error);
            this._lastError = s.error.message;
            return;
        }
        if (this._lastError) { this._lastError = null; this._onRecover(); }
        const now = performance.now();
        const sameTrack = this._track?.trackId === s.track.trackId;
        this._track = s.track;     // the same track may come back with its cover
        const predicted = this._anchorPos + (this._playing ? now - this._anchorAt : 0);
        if (sameTrack && s.playing === this._playing && s.playing && Math.abs(predicted - s.positionMs) < RESYNC_MS) return;
        this._playing = s.playing;
        this._anchorPos = s.positionMs;
        this._anchorAt = now;
    }
}

/** The bridge sends what went wrong ({ kind, app, apps, detail }); the words are made here. */
function errorText({ kind, app, apps = [], detail }) {
    app = t(app ?? '');
    apps = apps.map((a) => t(a));
    switch (kind) {
        case 'idle':
            if (apps.length) return t('Nothing is playing in {apps}', { apps: apps.join(t(' or ')) });
            return isWindows() ? t('Play a song in Spotify, Apple Music or a browser') : t('Open Spotify or Music and play a song');
        case 'permission': return t('Allow jizura-sync to control {app} in System Settings → Privacy & Security → Automation', { app });
        case 'script': return t('Could not read {app}: {detail}', { app, detail });
        default: return t('Could not read the current track from {app}', { app });
    }
}
