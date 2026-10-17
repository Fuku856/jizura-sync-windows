// Synced lyrics from several catalogues, asked at once and taken in SOURCES order:
//  - LRCLIB (https://lrclib.net): public, no key, CORS `*`; community LRC, strongest overall.
//  - PetitLyrics (プチリリ): Japanese lyrics service, word-timed; fills most Japanese gaps.
//  - lrc.red: Apple Music style TTML keyed by ISRC.
//  - NetEase Cloud Music: LRC, many Japanese / Chinese songs. No CORS, so only the Windows app
//    can ask it (through the host, see native.js `nativeHttp`).
// Every source ends up as LRC text, which is what JIZURA's planner already parses, so the rest
// is finding the right record and escaping JIZURA's own lyric markup.

import { hasNative, nativeHttp } from './native.js';

const API = 'https://lrclib.net/api';
// LRCLIB asks clients to identify themselves; browsers may not set User-Agent, so it accepts this.
const CLIENT = 'jizura-sync-windows (https://github.com/Fuku856/jizura-sync-windows)';
/** Longest Retry-After (s) we are willing to sit out before giving up on this track. */
const MAX_RETRY_AFTER_S = 30;

/** How far a catalogue's duration may differ from the player's before a hit is rejected (s). */
const DURATION_TOLERANCE_S = 4;

/** Tried at once; the first in this order with synced lyrics wins. `key` is for `?lyrics=`. */
const SOURCES = [
    { key: 'lrclib', name: 'LRCLIB', fetch: fetchLrclib },
    { key: 'petit', name: 'PetitLyrics', fetch: fetchPetit },
    { key: 'lrcred', name: 'lrc.red', fetch: fetchLrcRed },
    { key: 'netease', name: 'NetEase', fetch: fetchNetease, native: true },
];
/**
 * Once a lower source has synced lyrics, how long a higher one still pending may take (ms).
 * LRCLIB retries a 5xx after 2 s and 5 s; without this a busy LRCLIB held every song for 7 s+.
 */
const HIGHER_WAIT_MS = 3000;
/** Each request to the newer sources gives up after this; LRCLIB keeps its own retry ladder. */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * @param {{artist: string, title: string, album: string|null, durationMs: number}} track
 * @param {AbortSignal} [signal]
 * @param {string|null} [only] a SOURCES key: ask that source alone (`?lyrics=` while testing)
 * @returns {Promise<{synced: string|null, plain: string|null, instrumental: boolean, source: string} | null>}
 *   null when no source has a record for the track. Throws only when every source failed.
 */
export async function fetchLyrics(track, signal, only = null) {
    const sources = SOURCES.filter((s) => (!only || s.key === only) && (!s.native || hasNative()));
    if (!sources.length) throw new Error(`no lyrics source "${only}" here`);
    // Once there is an answer, the sources still running are stopped: LRCLIB's retries and
    // Retry-After waits would otherwise go on until the next track, using up its rate limit.
    const done = new AbortController();
    const inner = signal ? AbortSignal.any([signal, done.signal]) : done.signal;
    let deadline = null, passDeadline;
    const late = new Promise((resolve) => { passDeadline = resolve; });
    const runs = sources.map((s) => s.fetch(track, inner).then(
        (rec) => {
            if (rec?.synced && !deadline) deadline = setTimeout(passDeadline, HIGHER_WAIT_MS);
            return { rec: rec && { ...rec, source: s.name } };
        },
        (err) => { if (!inner.aborted) console.warn(`[jizura-sync] ${s.name}:`, err); return { err }; }));
    try {
        let fallback = null, firstErr = null, failed = 0;
        for (const run of runs) {
            const r = await Promise.race([run, late]);
            signal?.throwIfAborted();
            if (!r) continue;                       // still pending past the deadline: a lower source has it
            if (r.err) { failed++; firstErr ??= r.err; continue; }
            if (r.rec?.synced) return r.rec;
            fallback ??= r.rec;
        }
        if (!fallback && failed === runs.length) throw firstErr;
        return fallback;
    } finally {
        clearTimeout(deadline);
        done.abort();
    }
}

async function fetchLrclib(track, signal) {
    const durationS = Math.round(track.durationMs / 1000);
    // Spotify joins multiple artists with ", " (others with "&", "feat." …); LRCLIB indexes the
    // credited artist string, which is usually the first one alone.
    const artists = [...new Set([track.artist, firstArtist(track.artist)])];
    for (const artist of artists) {
        const params = new URLSearchParams({ artist_name: artist, track_name: track.title, duration: String(durationS) });
        if (track.album) params.set('album_name', track.album);
        const res = await lrclib(`/get?${params}`, signal);
        if (res.ok) return shape(await res.json());
        if (res.status !== 404) throw new Error(`LRCLIB /get ${res.status}`);
    }
    // /get matches strictly on duration (±2 s); /search does not, so filter it ourselves.
    const params = new URLSearchParams({ track_name: track.title, artist_name: artists[artists.length - 1] });
    const res = await lrclib(`/search?${params}`, signal);
    if (!res.ok) throw new Error(`LRCLIB /search ${res.status}`);
    const hits = (await res.json())
        .filter((h) => Math.abs((h.duration ?? 0) - durationS) <= DURATION_TOLERANCE_S)
        .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics));
    return hits.length ? shape(hits[0]) : null;
}

/** Waits before retrying a 5xx or a failed request: LRCLIB has short outages. */
const RETRY_DELAYS_S = [2, 5];

/**
 * GET with our client header. On 429 it waits out Retry-After once, as LRCLIB requires; a 5xx
 * or a network failure is retried after each of RETRY_DELAYS_S.
 */
async function lrclib(path, signal) {
    let waitedOut429 = false;
    for (let attempt = 0; ; attempt++) {
        let res;
        try {
            res = await fetch(`${API}${path}`, { signal, headers: { 'Lrclib-Client': CLIENT } });
        } catch (err) {
            if (signal?.aborted || attempt >= RETRY_DELAYS_S.length) throw err;
            await sleep(RETRY_DELAYS_S[attempt], signal);
            continue;
        }
        if (res.status === 429 && !waitedOut429) {
            const wait = Number(res.headers.get('Retry-After')) || 5;
            if (wait > MAX_RETRY_AFTER_S) return res;
            waitedOut429 = true;
            await sleep(wait, signal);
            attempt--;                  // the Retry-After wait is not one of the 5xx retries
            continue;
        }
        if (res.status < 500 || attempt >= RETRY_DELAYS_S.length) return res;
        await sleep(RETRY_DELAYS_S[attempt], signal);
    }
}

function sleep(seconds, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, seconds * 1000);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
}

function shape(rec) {
    return { synced: rec.syncedLyrics || null, plain: rec.plainLyrics || null, instrumental: !!rec.instrumental };
}

// --- matching a catalogue's hit to the playing track ---------------------------------------

/** Case, width, spaces and punctuation folded away, for comparing names across catalogues. */
function fold(s) {
    return (s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** The title without a trailing "(…)", "[…]", "【…】" or " - …" (versions, tie-ins, remasters). */
function baseTitle(s) {
    s ??= '';
    return fold(s.replace(/\s*[(（[［【〔].*$/, '').replace(/\s+[-–—]\s+.*$/, '')) || fold(s);
}

/** Between the names of a multi-artist credit: "A, B & C", "A × B", "A feat. B". */
const ARTIST_SEPARATOR = /\s*(?:[,、&＆×/;]|\s(?:feat\.?|ft\.|with)\s)\s*/i;

function splitArtists(s) {
    return (s ?? '').split(ARTIST_SEPARATOR).map(fold).filter(Boolean);
}

/**
 * Words that name a different recording of the same song: a cover, karaoke, live take, remix or
 * re-recording ("(Taylor's Version)", "(2023 Ver.)"). baseTitle() drops the brackets they sit in,
 * so they are compared on their own.
 */
const VERSION_WORDS = /翻唱|翻自|伴奏|カラオケ|歌ってみた|\b(?:cover|covered|karaoke|live|remix|inst|instrumental|off vocal|version|ver)\b/gi;

function versionWords(title) {
    return [...new Set(((title ?? '').match(VERSION_WORDS) ?? []).map((w) => w.toLowerCase()))].sort().join(' ');
}

/**
 * Whether a catalogue hit is the playing track: same length (when the hit has one), same base
 * title, the same version words, and an artist in common. The artist check is what keeps covers
 * out -- lrc.red answers 米津玄師「Lemon」 with 花僮's and 洛天依's covers.
 */
function matches(track, { title, artist, durationS }) {
    if (durationS && Math.abs(durationS - track.durationMs / 1000) > DURATION_TOLERANCE_S) return false;
    if (baseTitle(title) !== baseTitle(track.title)) return false;
    if (versionWords(title) !== versionWords(track.title)) return false;
    const mine = splitArtists(track.artist), theirs = splitArtists(artist);
    return mine.some((a) => theirs.some((b) => a === b || (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a)))));
}

/** The first credited artist: catalogues index that, not "A, B & C". */
function firstArtist(s) {
    return s.split(ARTIST_SEPARATOR)[0] || s;
}

function timeoutSignal(signal) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Rows `{t, end, text, newPart}` (seconds) -> LRC. A row that opens a new part (the source marks sections) or follows a silence of
 * INTERLUDE_MIN_S gets an empty row in front, at the previous row's end -- how LRC files mark a
 * pause, so partBreaks() and the [間奏] cuts treat these sources like LRCLIB's.
 */
function rowsToLrc(rows) {
    const out = [];
    rows.forEach((r, i) => {
        const prev = rows[i - 1];
        if (prev && (r.newPart || r.t - prev.end >= INTERLUDE_MIN_S)) out.push(tag(Math.min(prev.end, r.t)));
        out.push(`${tag(r.t)}${r.text}`);
    });
    if (rows.length) out.push(tag(rows[rows.length - 1].end));
    return out.join('\n');
}

function base64Utf8(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

// --- PetitLyrics (プチリリ) -----------------------------------------------------------------

const PETIT = 'https://p0.petitlyrics.com/api/GetPetitLyricsData.php';

/**
 * The API of PetitLyrics' Android SDK. `lyricsType=3` asks for word timing (`<wsy>`, base64);
 * a record that has only text comes back as type 1. A search lists up to maxCount records but
 * carries lyrics for the first one alone; another one is fetched again by `key_lyricsId`.
 */
async function petit(params, signal) {
    const body = new URLSearchParams({ terminalType: '10', clientAppId: 'p1110417', lyricsType: '3', ...params });
    const res = await fetch(PETIT, { method: 'POST', body, signal: timeoutSignal(signal) });
    if (!res.ok) throw new Error(`PetitLyrics ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    return [...doc.getElementsByTagName('song')].map((el) => {
        const get = (k) => el.getElementsByTagName(k)[0]?.textContent ?? '';
        return { id: get('lyricsId'), title: get('title'), artist: get('artist'), durationS: Number(get('duration')) / 1000,
                 type: get('lyricsType'), official: get('isOfficial') === '1', data: get('lyricsData') };
    });
}

async function fetchPetit(track, signal) {
    const songs = await petit({ key_title: track.title, key_artist: firstArtist(track.artist), maxCount: '10' }, signal);
    const hits = songs.filter((s) => matches(track, s));
    const hit = hits.find((s) => s.official) ?? hits[0];
    if (!hit) return null;
    const rec = hit.data ? hit : (await petit({ key_lyricsId: hit.id }, signal))[0];
    if (!rec?.data) return null;
    const text = base64Utf8(rec.data);
    // Word or line timing is `<wsy>` XML, which may follow a BOM or an XML declaration.
    if (rec.type === '3' || /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?<wsy[\s>]/.test(text)) return { synced: wsyToLrc(text), plain: null, instrumental: false };
    return { synced: null, plain: text, instrumental: false };
}

/** `<wsy><line><linestring>…</linestring><word><starttime>ms</starttime><endtime>ms</endtime>…` -> LRC. An empty line is a section break. */
function wsyToLrc(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [];
    let newPart = false;
    for (const line of doc.getElementsByTagName('line')) {
        const text = line.getElementsByTagName('linestring')[0]?.textContent.trim() ?? '';
        const starts = [...line.getElementsByTagName('starttime')].map((e) => Number(e.textContent));
        const ends = [...line.getElementsByTagName('endtime')].map((e) => Number(e.textContent));
        if (!text || !starts.length) { newPart = rows.length > 0; continue; }
        rows.push({ t: starts[0] / 1000, end: Math.max(...ends, starts[0]) / 1000, text, newPart });
        newPart = false;
    }
    return rowsToLrc(rows);
}

// --- lrc.red --------------------------------------------------------------------------------

const LRC_RED = 'https://lrc.red';

async function fetchLrcRed(track, signal) {
    const params = new URLSearchParams({ track: track.title, artist: firstArtist(track.artist), duration: String(Math.round(track.durationMs / 1000)) });
    const res = await fetch(`${LRC_RED}/match.json?${params}`, { signal: timeoutSignal(signal) });
    if (!res.ok) throw new Error(`lrc.red ${res.status}`);
    const hit = ((await res.json()).hits ?? []).find((h) => matches(track, { title: h.title, artist: h.artist, durationS: h.duration }));
    if (!hit) return null;
    const ttml = await fetch(`${LRC_RED}/s/${encodeURIComponent(hit.isrc)}.ttml`, { signal: timeoutSignal(signal) });
    if (ttml.status === 404) return null;
    if (!ttml.ok) throw new Error(`lrc.red ${ttml.status}`);
    return ttmlToRecord(await ttml.text());
}

/** TTML clock values: "1:02:03.4", "2:03.456", "3.456", "3.456s", "3456ms". */
function ttmlTime(s) {
    if (!s) return NaN;
    if (s.endsWith('ms')) return parseFloat(s) / 1000;
    if (s.endsWith('s')) return parseFloat(s);
    return s.split(':').reduce((acc, v) => acc * 60 + parseFloat(v), 0);
}

/**
 * Apple Music style TTML -> lyric record. Lines are the `<p>`s of the body (the head holds
 * translations and readings); background vocals (`ttm:role="x-bg"`) are left out, and each
 * `<div>` is a song part (verse, chorus …). A file with no timing is plain text.
 */
function ttmlToRecord(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = doc.getElementsByTagNameNS('*', 'body')[0];
    if (!body) return null;
    const rows = [], texts = [];
    let part = null;
    for (const p of body.getElementsByTagNameNS('*', 'p')) {
        const line = p.cloneNode(true);
        for (const el of [...line.getElementsByTagName('*')]) {
            if ([...el.attributes].some((a) => a.localName === 'role' && a.value === 'x-bg')) el.remove();
        }
        const text = line.textContent.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        texts.push(text);
        const spans = line.getElementsByTagNameNS('*', 'span');      // without the background vocals
        const t = ttmlTime(p.getAttribute('begin') ?? spans[0]?.getAttribute('begin'));
        const end = ttmlTime(p.getAttribute('end') ?? spans[spans.length - 1]?.getAttribute('end'));
        if (Number.isNaN(t)) continue;
        rows.push({ t, end: Number.isNaN(end) ? t : end, text, newPart: part !== null && p.parentNode !== part });
        part = p.parentNode;
    }
    if (rows.length) return { synced: rowsToLrc(rows), plain: null, instrumental: false };
    return texts.length ? { synced: null, plain: texts.join('\n'), instrumental: false } : null;
}

// --- NetEase Cloud Music ----------------------------------------------------------------------

const NETEASE = 'https://music.163.com/api';

/** NetEase sends no CORS headers; the Windows host fetches it (`music.163.com` only). */
async function netease(path, form, signal) {
    const res = await nativeHttp(`${NETEASE}${path}`, form, signal).catch((err) => { throw new Error(`NetEase ${err.message}`); });
    if (res.status !== 200) throw new Error(`NetEase ${res.status}`);
    return JSON.parse(res.body);
}

async function fetchNetease(track, signal) {
    const found = await netease('/cloudsearch/pc', { s: `${track.title} ${firstArtist(track.artist)}`, type: '1', limit: '10', offset: '0' }, signal);
    const hit = (found.result?.songs ?? []).find((s) =>
        matches(track, { title: s.name, artist: (s.ar ?? []).map((a) => a.name).join(', '), durationS: s.dt / 1000 }));
    if (!hit) return null;
    const lyr = await netease(`/song/lyric?id=${hit.id}&lv=1`, null, signal);
    const lrc = dropCredits(lyr.lrc?.lyric ?? '');
    if (lyr.nolyric || lyr.pureMusic || /纯音乐，请欣赏/.test(lrc)) return { synced: null, plain: null, instrumental: true };
    // Synced when sung rows carry real times; unsynced NetEase text is all at [00:00.00].
    const timed = lrc.split('\n').filter((l) => LRC_ROW.exec(l)?.[2].trim() && !/^\[00:00[.:]00?0?\]/.test(l));
    if (timed.length >= 3) return { synced: lrc, plain: null, instrumental: false };
    const plain = lrc.replace(/^(?:\[[^\]]*\])+/gm, '').trim();
    return plain ? { synced: null, plain, instrumental: false } : null;
}

/**
 * NetEase opens with credit rows timed like lyrics: "[00:00.000] 作词 : 米津玄師", 作曲, 编曲,
 * 制作人, "Mixing Engineer : …" … Rows of the form "name : value" before the first sung row are
 * dropped -- a name of up to 24 characters with no comma or sentence mark, so "Baby, listen: …"
 * stays; a colon later in the song is lyrics.
 */
function dropCredits(lrc) {
    let sung = false;
    return lrc.replace(/\r/g, '').split('\n').filter((raw) => {
        const m = raw.match(LRC_ROW);
        const text = m?.[2].trim();
        if (!text || sung) return true;
        if (/^[^:：,，.。!?！？]{1,24}[:：]/.test(text)) return false;
        sung = true;
        return true;
    }).join('\n');
}

/** An LRC row: one or more `[mm:ss.xx]` tags (group 1), then the text (group 2). */
const LRC_ROW = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/;

/** A silent stretch at least this long becomes a JIZURA [間奏] cut (graphics, no lyric). */
const INTERLUDE_MIN_S = 6;

/**
 * LRC -> JIZURA lyric source. JIZURA reads the same `[mm:ss.xx]` tags, but a few characters in
 * the line text are markup to it (`|` note, `*emphasis*`, `/` manual split, a leading `#` is a
 * comment) -- those are swapped for their full-width forms so real lyrics are shown verbatim.
 * A trailing `!` is left alone on purpose: JIZURA reads it as an "impact" line, which suits
 * a line the singer actually shouts.
 *
 * @param {string} lrc
 * @returns {{lyrics: string, lines: number, parts: number}}
 */
export function lrcToJizura(lrc) {
    const rows = [];
    for (const raw of lrc.replace(/\r/g, '').split('\n')) {
        const m = raw.match(LRC_ROW);
        if (!m) continue;                                   // [ar:] / [ti:] headers and junk
        const times = [...m[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)].map((t) => +t[1] * 60 + parseFloat(t[2].replace(':', '.')));
        const text = escapeMarkup(unifyRadicals(m[2].trim()));
        for (const t of times) rows.push({ t, text });
    }
    rows.sort((a, b) => a.t - b.t);

    // 1. sung lines, each remembering the blank row / long silence in front of it
    const sung = [];
    let blank = false, interlude = null;
    rows.forEach((r, i) => {
        if (r.text) { sung.push({ t: r.t, text: r.text, blank, interlude }); blank = false; interlude = null; return; }
        if (sung.length) blank = true;
        const next = rows[i + 1];
        if (next && next.t - r.t >= INTERLUDE_MIN_S && interlude === null) interlude = r.t;
    });

    // 2. part breaks. An empty row is how JIZURA marks a part, and 統一感 keeps one small set of
    // layouts / motions per part -- so a song with no breaks is one part and looks monotonous.
    const breaks = partBreaks(sung);

    // 3. JIZURA source
    const out = [];
    sung.forEach((s, i) => {
        if (i > 0 && breaks[i]) out.push('');
        if (s.interlude !== null) out.push(`${tag(s.interlude)}[間奏]`);
        out.push(`${tag(s.t)}${s.text}`);
    });
    if (interlude !== null) out.push('', `${tag(interlude)}[間奏]`);
    return { lyrics: out.join('\n'), lines: sung.length, parts: 1 + breaks.filter((b, i) => b && i > 0).length };
}

/** A part longer than this is split at its longest line interval. */
const MAX_PART_LINES = 8;
/**
 * A part shorter than this is merged into a neighbour. 統一感 picks a fresh palette per part, so
 * a string of 1–2 line parts reads as random again -- which is what repeats of short phrases
 * ("Come on now, follow my lead") produced before this floor existed.
 */
const MIN_PART_LINES = 3;
/** A repeat shorter than this is a hook line, not a section (Lemon repeats 「今でもあなたはわたしの光」 alone). */
const MIN_REPEAT_RUN = 2;

// Break strength: which break survives when a too-short part has to be merged away.
// A [間奏] is a part boundary to JIZURA no matter what, so it is never removed.
const INTERLUDE = 4, BLANK = 3, PAUSE = 2, REPEAT = 2, LENGTH = 1;

/**
 * breaks[i] = a new part starts at sung line i. Signals, strongest first:
 *  - a long silence ([間奏]) or a timed blank row in the LRC (the source itself marks a pause)
 *  - a start-to-start interval far above the song's norm (sources that mark nothing)
 *  - a run of lines that repeats earlier lines (サビ): both copies become parts of their own
 * then parts under MIN_PART_LINES are merged away (weakest break first), and parts still over
 * MAX_PART_LINES are split at their longest interval -- for songs sung without a pause and
 * without exact repeats.
 */
function partBreaks(sung) {
    const n = sung.length, br = new Array(n).fill(0);
    const set = (i, s) => { if (i > 0 && i < n) br[i] = Math.max(br[i], s); };
    const gap = partBreakGap(sung);
    sung.forEach((s, i) => {
        if (s.interlude !== null) set(i, INTERLUDE);
        if (s.blank) set(i, BLANK);
        if (i > 0 && s.t - sung[i - 1].t >= gap) set(i, PAUSE);
    });

    // repeats: rep[i] = index of the first line with the same text, or -1
    const norm = (t) => t.replace(/[\s、。，．,.!！?？…・「」『』（）()"'“”‘’~〜ー―-]/g, '').toLowerCase();
    const first = new Map(), rep = sung.map((s, i) => {
        const k = norm(s.text);
        if (k.length < 2) return -1;
        if (first.has(k)) return first.get(k);
        first.set(k, i);
        return -1;
    });
    for (let a = 0; a < n;) {
        if (rep[a] < 0) { a++; continue; }
        let b = a;
        while (b + 1 < n && rep[b + 1] === rep[b] + 1) b++;   // the copy continues line by line
        if (b - a + 1 >= MIN_REPEAT_RUN) {
            const len = b - a + 1;
            for (const i of [a, b + 1, rep[a], rep[a] + len]) set(i, REPEAT);
        }
        a = b + 1;
    }

    // merge parts that are too short into the neighbour behind the weaker break
    for (;;) {
        const starts = [0, ...br.flatMap((s, i) => (s ? [i] : []))];
        let fixed = false;
        for (let p = 0; p < starts.length && !fixed; p++) {
            const a = starts[p], b = p + 1 < starts.length ? starts[p + 1] : n;   // part = a..b-1
            if (b - a >= MIN_PART_LINES) continue;
            const before = a > 0 && br[a] < INTERLUDE ? br[a] : Infinity;        // break opening this part
            const after = b < n && br[b] < INTERLUDE ? br[b] : Infinity;         // break closing it
            if (before === Infinity && after === Infinity) continue;            // walled in by [間奏]
            br[before <= after ? a : b] = 0;
            fixed = true;
        }
        if (!fixed) break;
    }

    // length cap: split at the longest interval that leaves both halves at least MIN_PART_LINES
    const split = (a, b) => {                                  // part = lines a..b inclusive
        if (b - a + 1 <= MAX_PART_LINES) return;
        let k = -1, best = -1;
        for (let j = a + MIN_PART_LINES; j <= b - MIN_PART_LINES + 1; j++) { const d = sung[j].t - sung[j - 1].t; if (d > best) { best = d; k = j; } }
        if (k < 0) return;
        br[k] = LENGTH;
        split(a, k - 1);
        split(k, b);
    };
    let start = 0;
    for (let i = 1; i <= n; i++) if (i === n || br[i]) { split(start, i - 1); start = i; }
    return br.map(Boolean);
}

/**
 * Start-to-start interval that counts as a part break: 1.8x the song's median line interval,
 * never under 4 s. Relative, because line length follows the song's tempo. Checked against
 * LRCLIB files whose blank rows mark parts: finds 9 of 12 marked breaks over 4 songs; a song
 * sung without pauses (Shape of You) has no interval that long -- the repeat and length rules
 * in partBreaks() cover it.
 */
function partBreakGap(textRows) {
    const iv = textRows.slice(1).map((r, i) => r.t - textRows[i].t).sort((a, b) => a - b);
    if (!iv.length) return Infinity;
    return Math.max(4, 1.8 * iv[iv.length >> 1]);
}

/**
 * Kangxi radicals and CJK radical supplements (U+2E80–U+2FDF) -> the ordinary kanji they look
 * like. lrc.red's text has them in place of kanji (「⼆⼈」「⽇」), which fonts draw apart from
 * the rest of the line or not at all.
 */
function unifyRadicals(s) {
    return s.replace(/[⺀-⿟]/g, (c) => c.normalize('NFKC'));
}

function escapeMarkup(s) {
    return s.replace(/^#/, '＃').replace(/\|/g, '｜').replace(/\*/g, '＊').replace(/\//g, '／');
}

function tag(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
}
