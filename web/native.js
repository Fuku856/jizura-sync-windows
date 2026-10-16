// Playback from the Windows app (win/Program.cs), which reads the system's media sessions and posts
// each reading as a web message. Same interface as SpotifyPlayer.

import { t } from './i18n.js';

/** A reading that disagrees with the running clock by less than this is jitter, not a seek. */
const RESYNC_MS = 120;

/** `chrome.webview` exists only inside a WebView2 host, not in Edge itself. */
const webview = () => window.chrome?.webview;

export const hasNative = () => !!webview();

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
        webview().addEventListener('message', this._onMessage);
        this._post({ cmd: 'start' });
    }

    stop() { webview().removeEventListener('message', this._onMessage); }

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
    /** Move the window with the mouse button that is down now. */
    dragWindow() { this._post({ cmd: 'dragWindow' }); }
    seek(ms) {
        ms = Math.max(0, Math.round(ms));
        // Move the local clock now so the lyrics jump with the slider; the next reading confirms.
        if (this._track) { this._anchorPos = ms; this._anchorAt = performance.now(); }
        this._post({ cmd: 'seek', ms });
    }

    _post(msg) {
        if (['play', 'pause', 'next', 'previous', 'seek'].includes(msg.cmd)) msg.seq = ++this._seq;
        webview().postMessage(msg);
    }

    _update(s) {
        if (s.seq < this._seq) return;
        if (s.error) {
            s.error.message = errorText(s.error);
            // Nothing to follow. A failed read keeps the track: the retry usually succeeds, and
            // dropping it would blank the bar in between.
            if (s.error.kind === 'idle') {
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
            return t('Play a song in Spotify, Apple Music or a browser');
        case 'script': return t('Could not read {app}: {detail}', { app, detail });
        default: return t('Could not read the current track from {app}', { app });
    }
}
