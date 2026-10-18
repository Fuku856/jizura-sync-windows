// UI text in English or Japanese, following the Windows app's (WebView2's) language. Keys are
// the English text; `{name}` is filled from `vars`. A key missing from JA shows in English.

const JA = {
    // playback from the Windows app
    'Play a song in Spotify, Apple Music or a browser': 'Spotify、Apple Music またはブラウザで曲を再生してください',
    'Nothing is playing in {apps}': '{apps}で何も再生していません',
    ' or ': 'と',
    'Could not read {app}: {detail}': '{app}を読み取れませんでした: {detail}',
    'Could not read the current track from {app}': '{app}の再生中の曲を読み取れませんでした',
    'Open this in the jizura-sync Windows app, or add ?mock to the URL': 'jizura-sync の Windows アプリで開くか、URL に ?mock を付けてください',

    // lyrics and look
    'Looking up lyrics…': '歌詞を検索しています…',
    'Lyrics lookup failed: {detail}': '歌詞を検索できませんでした: {detail}',
    'No lyrics: lookup failed ({detail})': '歌詞なし: 検索に失敗しました（{detail}）',
    'Instrumental': 'インストゥルメンタル',
    'No synced lyrics for this track': 'この曲にはタイミング付きの歌詞がありません',
    'No lyrics: a stream has no song position to time them to': '歌詞なし: ストリームには曲の中の再生位置がないため、タイミングを合わせられません',
    'No lyrics found for this track': 'この曲の歌詞が見つかりません',
    'Lyrics: {source}': '歌詞: {source}',
    'PetitLyrics': 'プチリリ',
    '{n} cuts': '{n} カット',
    'same style per section': 'セクションごとに同じスタイル',
    'Lyrics timing reset': '歌詞のタイミングをリセットしました',
    'Lyrics {ms} ms earlier': '歌詞を {ms} ms 早くしました',
    'Lyrics {ms} ms later': '歌詞を {ms} ms 遅くしました',
    'Same style within each song section': 'セクションごとに同じスタイル',
    'Every line styled independently': '行ごとに別のスタイル',
    'Motion: as the look picks': 'モーション: ルックに合わせる',
    'Motion: smooth': 'モーション: なめらか',
    'Motion: choppy, {fps} fps': 'モーション: コマ打ち {fps} fps',

    // index.html
    'Previous track': '前の曲',
    'Play/pause': '再生 / 一時停止',
    'Next track': '次の曲',
    'Seek': 'シーク',
    'Keyboard shortcuts': 'キーボードショートカット',
    'Fullscreen': 'フルスクリーン',
    'Exit fullscreen': 'フルスクリーンを終了',
    'Controls': '操作',
    'Click': 'クリック',
    'help.bar': 'バーを隠す / 表示する（<kbd>H</kbd> でも）',
    'help.r': '新しいランダムなルック: スタイル、ムード、色、フォント、使うパーツ',
    'help.u': 'セクションごとに同じスタイル（オン）/ 行ごとに別のスタイル（オフ）',
    'help.k': 'モーション: ルックに合わせる → なめらか → コマ打ち 12 fps → 8 fps（手描きアニメ風）',
    'help.offset': '歌詞が曲より早い / 遅いときに、50 ms 遅く / 早く',
    'help.space': '再生 / 一時停止',
    'help.f': 'フルスクリーン（ダブルクリックでも）',
    'help.help': 'このヘルプ',
};

export const lang = /^ja\b/i.test(navigator.languages?.[0] || navigator.language || '') ? 'ja' : 'en';

export function t(key, vars = {}) {
    const text = (lang === 'ja' && JA[key]) || key;
    return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/**
 * Translates index.html in place: `data-i18n` (text, the English text is the key),
 * `data-i18n-html` (a key whose Japanese entry keeps markup such as <kbd>; the dictionary is
 * static) and `data-i18n-aria`.
 */
export function localizePage() {
    document.documentElement.lang = lang;
    if (lang !== 'ja') return;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.textContent.trim());
    for (const el of document.querySelectorAll('[data-i18n-html]')) if (JA[el.dataset.i18nHtml]) el.innerHTML = JA[el.dataset.i18nHtml];
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.getAttribute('aria-label')));
}
