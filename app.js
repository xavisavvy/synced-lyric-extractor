(() => {
  'use strict';

  const STORAGE_KEY = 'synced-lyric-extractor-session-v1';

  // ---- state ----
  let lines = [];        // [{ text, time }]  time = seconds|null
  let pointer = 0;       // index of the "next line to tag"
  let audioObjectUrl = null;
  let audioFileHint = null;   // { name, size } of the file the current session was tagged against
  let pendingResumeHint = null; // set after "Resume previous session", checked against the next file picked

  // ---- undo/redo history (Ctrl+Z / Ctrl+Shift+Z) ----
  const MAX_HISTORY = 25;
  let undoStack = [];
  let redoStack = [];

  // ---- elements: setup view ----
  const audioInput = document.getElementById('audio-input');
  const audioFilename = document.getElementById('audio-filename');
  const previewAudio = document.getElementById('preview-audio');
  const lyricsInput = document.getElementById('lyrics-input');
  const lyricsFileInput = document.getElementById('lyrics-file-input');
  const clearLyricsBtn = document.getElementById('clear-lyrics-btn');
  const startSyncBtn = document.getElementById('start-sync-btn');
  const setupError = document.getElementById('setup-error');
  const resumeBtn = document.getElementById('resume-btn');

  // ---- elements: sync view ----
  const setupView = document.getElementById('setup-view');
  const syncView = document.getElementById('sync-view');
  const syncAudio = document.getElementById('sync-audio');
  const back5Btn = document.getElementById('back5-btn');
  const back1Btn = document.getElementById('back1-btn');
  const rateSelect = document.getElementById('rate-select');
  const clockDisplay = document.getElementById('clock-display');
  const currentLineText = document.getElementById('current-line-text');
  const tapBtn = document.getElementById('tap-btn');
  const undoBtn = document.getElementById('undo-btn');
  const linesList = document.getElementById('lines-list');
  const resetBtn = document.getElementById('reset-btn');

  // ---- elements: export ----
  const exportPanel = document.getElementById('export-panel');
  const exportOutput = document.getElementById('export-output');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const copyStatus = document.getElementById('copy-status');
  const exportStoryboarderBtn = document.getElementById('export-storyboarder-btn');

  // ---- elements: embedded (ID3) lyrics detection ----
  const id3Panel = document.getElementById('id3-lyrics-panel');
  const id3Summary = document.getElementById('id3-lyrics-summary');
  const loadUsltBtn = document.getElementById('load-uslt-btn');
  const loadSyltBtn = document.getElementById('load-sylt-btn');
  let detectedLyrics = null; // { uslt: string[], sylt: {...}[], usableSylt: {...}[] } | null
  let coverArtUrl = null; // object URL for embedded cover art (APIC/PIC frame), if any
  let trackTitle = null;  // from ID3 TIT2/TT2, if present
  let trackArtist = null; // from ID3 TPE1/TP1, if present

  // ---- elements: fullscreen lyric video ----
  const openLyricVideoBtn = document.getElementById('open-lyric-video-btn');
  const lyricVideoOverlay = document.getElementById('lyric-video-overlay');
  const closeLyricVideoBtn = document.getElementById('close-lyric-video-btn');
  const lyricVideoCoverImg = document.getElementById('lyric-video-cover-img');
  const lyricVideoArtFallback = document.getElementById('lyric-video-art-fallback');
  const lyricVideoArt = document.getElementById('lyric-video-art');
  const lyricVideoLyrics = document.getElementById('lyric-video-lyrics');
  const lvPlayBtn = document.getElementById('lv-play-btn');
  // Belt-and-suspenders: guarantee the overlay starts hidden regardless of
  // markup or cache. (The real bug this used to mask: the page's CSP blocks
  // inline style="display:none" attributes from ever applying at all, which
  // is why every hidden-by-default element now uses the .hidden CSS class
  // instead — classList operations aren't affected by that restriction.)
  lyricVideoOverlay.classList.add('hidden');
  const lvSeek = document.getElementById('lv-seek');
  const lvTimeCurrent = document.getElementById('lv-time-current');
  const lvTimeTotal = document.getElementById('lv-time-total');
  const lyricVideoTitleEl = document.getElementById('lyric-video-title');
  const lyricVideoArtistEl = document.getElementById('lyric-video-artist');
  let lyricVideoOpen = false;
  let lyricVideoLines = []; // tagged lines, sorted by time, currently rendered in the overlay
  let isDraggingLvSeek = false;

  // ---------------------------------------------------------------------
  // time formatting: "MM:SS.mmm" matching the requested output style
  // ---------------------------------------------------------------------
  function formatTime(totalSeconds) {
    const clamped = Math.max(0, totalSeconds);
    // round to whole milliseconds first so the minute/second split can't be
    // invalidated by toFixed(3) rounding up across a minute boundary
    // (e.g. 59.9997 -> floor(0/60)=0min + "60.000"s instead of 1min + "00.000"s)
    const totalMs = Math.round(clamped * 1000);
    const minutes = Math.floor(totalMs / 60000);
    const seconds = (totalMs % 60000) / 1000;
    const mm = String(minutes).padStart(2, '0');
    const ss = seconds.toFixed(3).padStart(6, '0');
    return `${mm}:${ss}`;
  }

  // ---------------------------------------------------------------------
  // ID3v2 embedded-lyrics extraction (USLT = plain lyrics, SYLT = synced
  // lyrics with per-line timestamps already baked in). Pure binary parsing
  // of the tag the browser already has locally — no network, no library.
  // ---------------------------------------------------------------------
  function readSynchsafeUint32(bytes, offset) {
    return (
      ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f)
    );
  }

  function readUint32(bytes, offset) {
    return (
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0
    );
  }

  function readUint24(bytes, offset) {
    return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
  }

  function findId3Terminator(bytes, start, encoding) {
    const wide = encoding === 1 || encoding === 2; // UTF-16 variants use a 2-byte null terminator
    const step = wide ? 2 : 1;
    for (let i = start; i <= bytes.length - step; i += step) {
      if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return i;
    }
    return bytes.length;
  }

  function decodeId3Text(bytes, encoding) {
    if (bytes.length === 0) return '';
    try {
      switch (encoding) {
        case 1: // UTF-16 with BOM
          if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
          if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
          return new TextDecoder('utf-16le').decode(bytes);
        case 2: // UTF-16BE, no BOM (v2.4 only)
          return new TextDecoder('utf-16be').decode(bytes);
        case 3: // UTF-8 (v2.4 only)
          return new TextDecoder('utf-8').decode(bytes);
        default: // 0: ISO-8859-1
          return new TextDecoder('iso-8859-1').decode(bytes);
      }
    } catch (e) {
      return '';
    }
  }

  function parseUsltFrame(bytes) {
    const encoding = bytes[0];
    let pos = 4; // skip encoding byte + 3-byte language code
    const descEnd = findId3Terminator(bytes, pos, encoding);
    pos = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
    return decodeId3Text(bytes.subarray(pos), encoding).replace(/ +$/, '');
  }

  function parseSyltFrame(bytes) {
    const encoding = bytes[0];
    const timestampFormat = bytes[4]; // 1 = MPEG frames, 2 = milliseconds
    const contentType = bytes[5]; // 0=other,1=lyrics,2=transcription (per spec)
    const wide = encoding === 1 || encoding === 2;
    let pos = 6;
    const entries = [];
    while (pos < bytes.length) {
      const termPos = findId3Terminator(bytes, pos, encoding);
      const text = decodeId3Text(bytes.subarray(pos, termPos), encoding);
      pos = termPos + (wide ? 2 : 1);
      if (pos + 4 > bytes.length) break;
      const timeMs = readUint32(bytes, pos);
      pos += 4;
      if (text.trim()) entries.push({ text: text.trim(), timeMs });
    }
    return { timestampFormat, contentType, entries };
  }

  function parseTextFrame(bytes) {
    const encoding = bytes[0];
    const text = decodeId3Text(bytes.subarray(1), encoding);
    return text.split('\u0000')[0].trim();
  }

  function parseApicFrame(bytes, majorVersion) {
    const encoding = bytes[0];
    let pos = 1;
    let mimeType;
    if (majorVersion === 2) {
      const fmt = String.fromCharCode(bytes[1], bytes[2], bytes[3]).toUpperCase();
      mimeType = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
      pos = 4;
    } else {
      const mimeEnd = findId3Terminator(bytes, pos, 0);
      mimeType = decodeId3Text(bytes.subarray(pos, mimeEnd), 0);
      pos = mimeEnd + 1;
    }
    // skip "-->" (linked/URL image) and anything not a recognizable image type —
    // we never want to fetch an external URL to display art
    if (!mimeType || mimeType.indexOf('image/') !== 0) return null;
    const pictureType = bytes[pos];
    pos += 1;
    const descEnd = findId3Terminator(bytes, pos, encoding);
    pos = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
    const imageBytes = bytes.subarray(pos);
    if (imageBytes.length < 8) return null;
    return { mimeType, pictureType, bytes: imageBytes };
  }

  async function extractId3Lyrics(file) {
    try {
      const headerBytes = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (headerBytes.length < 10) return null;
      if (String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2]) !== 'ID3') return null;

      const majorVersion = headerBytes[3];
      const flags = headerBytes[5];
      const tagSize = readSynchsafeUint32(headerBytes, 6);
      const totalLen = Math.min(file.size, 10 + tagSize);
      const bytes = new Uint8Array(await file.slice(0, totalLen).arrayBuffer());

      let offset = 10;
      if (flags & 0x40) {
        // extended header present — best-effort skip, bail out cleanly on anything unexpected
        const extSize = majorVersion >= 4 ? readSynchsafeUint32(bytes, offset) : readUint32(bytes, offset);
        offset += extSize + (majorVersion >= 4 ? 4 : 0);
      }

      const idLen = majorVersion === 2 ? 3 : 4;
      const frameHeaderLen = majorVersion === 2 ? 6 : 10;
      const uslt = [];
      const sylt = [];
      let coverArt = null;
      let title = null;
      let artist = null;

      while (offset + frameHeaderLen <= bytes.length) {
        const id = String.fromCharCode(...bytes.subarray(offset, offset + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break; // padding / end of frames

        const frameSize =
          majorVersion === 2
            ? readUint24(bytes, offset + 3)
            : majorVersion === 4
              ? readSynchsafeUint32(bytes, offset + 4)
              : readUint32(bytes, offset + 4);

        const frameDataStart = offset + frameHeaderLen;
        const frameDataEnd = frameDataStart + frameSize;
        if (frameSize <= 0 || frameDataEnd > bytes.length) break;

        const frameBytes = bytes.subarray(frameDataStart, frameDataEnd);
        try {
          if (id === 'USLT' || id === 'ULT') {
            const text = parseUsltFrame(frameBytes);
            if (text.trim()) uslt.push(text);
          } else if (id === 'SYLT' || id === 'SLT') {
            const parsed = parseSyltFrame(frameBytes);
            if (parsed.entries.length) sylt.push(parsed);
          } else if (id === 'APIC' || id === 'PIC') {
            const art = parseApicFrame(frameBytes, majorVersion);
            // prefer an explicit "front cover" (type 3) over whatever we saw first
            if (art && (!coverArt || art.pictureType === 3)) coverArt = art;
          } else if (id === 'TIT2' || id === 'TT2') {
            const t = parseTextFrame(frameBytes);
            if (t) title = t;
          } else if (id === 'TPE1' || id === 'TP1') {
            const a = parseTextFrame(frameBytes);
            if (a) artist = a;
          }
        } catch (e) {
          // one malformed frame shouldn't abort the whole scan
        }

        offset = frameDataEnd;
      }

      if (uslt.length === 0 && sylt.length === 0 && !coverArt && !title && !artist) return null;
      const usableSylt = sylt.filter((s) => s.timestampFormat === 2 && s.contentType <= 2);
      return { uslt, sylt, usableSylt, coverArt, title, artist };
    } catch (e) {
      return null; // tag parsing must never break the rest of the app
    }
  }

  function showDetectedLyricsPanel(result) {
    const parts = [];
    if (result.uslt.length) parts.push(`plain lyrics text`);
    if (result.usableSylt.length) parts.push(`${result.usableSylt[0].entries.length} pre-synced line(s)`);
    if (!parts.length) return; // e.g. only an unusable MPEG-frame-timed SYLT

    id3Summary.textContent = `Found embedded lyrics in this file (${parts.join(' and ')}).`;
    loadUsltBtn.classList.toggle('hidden', !result.uslt.length);
    loadSyltBtn.classList.toggle('hidden', !result.usableSylt.length);
    id3Panel.classList.remove('hidden');
  }

  loadUsltBtn.addEventListener('click', () => {
    if (!detectedLyrics || !detectedLyrics.uslt.length) return;
    if (lyricsInput.value.trim() && !confirm('This will replace the current lyrics text. Continue?')) return;
    lyricsInput.value = detectedLyrics.uslt[0]
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    updateStartButton();
  });

  loadSyltBtn.addEventListener('click', () => {
    if (!detectedLyrics || !detectedLyrics.usableSylt.length) return;
    if (!confirm('This will load the pre-synced timestamps from the file and jump straight into the sync view (skipping manual tapping). You can still re-tap or edit any line there. Continue?')) return;
    const entries = detectedLyrics.usableSylt[0].entries;
    lines = entries.map((e) => ({ text: e.text, time: e.timeMs / 1000 }));
    pointer = lines.length;
    const file = audioInput.files[0];
    audioFileHint = file ? { name: file.name, size: file.size } : null;
    pendingResumeHint = null;
    lyricsInput.value = lines.map((l) => l.text).join('\n');
    syncAudio.src = audioObjectUrl;
    enterSyncView();
    saveSession();
  });

  // ---------------------------------------------------------------------
  // setup view
  // ---------------------------------------------------------------------
  audioInput.addEventListener('change', () => {
    const file = audioInput.files[0];
    if (!file) return;
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = URL.createObjectURL(file);
    previewAudio.src = audioObjectUrl;
    previewAudio.classList.remove('hidden');
    audioFilename.textContent = file.name;
    updateStartButton();

    if (pendingResumeHint) {
      const mismatched = pendingResumeHint.name !== file.name || pendingResumeHint.size !== file.size;
      setupError.textContent = mismatched
        ? `Heads up: this doesn't look like the same file this session was tagged against (expected "${pendingResumeHint.name}"). Timestamps may not line up.`
        : '';
    }

    detectedLyrics = null;
    id3Panel.classList.add('hidden');
    if (coverArtUrl) { URL.revokeObjectURL(coverArtUrl); coverArtUrl = null; }
    trackTitle = null;
    trackArtist = null;
    extractId3Lyrics(file).then((result) => {
      // ignore a stale result if the user already picked a different file
      if (audioInput.files[0] !== file || !result) return;
      detectedLyrics = result;
      showDetectedLyricsPanel(result);
      if (result.coverArt) {
        coverArtUrl = URL.createObjectURL(new Blob([result.coverArt.bytes], { type: result.coverArt.mimeType }));
      }
      trackTitle = result.title;
      trackArtist = result.artist;
    });
  });

  lyricsFileInput.addEventListener('change', () => {
    const file = lyricsFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      lyricsInput.value = reader.result;
      updateStartButton();
    };
    reader.readAsText(file);
  });

  clearLyricsBtn.addEventListener('click', () => {
    lyricsInput.value = '';
    updateStartButton();
  });

  lyricsInput.addEventListener('input', updateStartButton);

  function updateStartButton() {
    const hasAudio = !!audioInput.files[0];
    const hasLyrics = lyricsInput.value.trim().length > 0;
    startSyncBtn.disabled = !(hasAudio && hasLyrics);
    setupError.textContent = '';
  }

  // Reconcile freshly-parsed lyric lines against whatever `lines` already
  // holds (e.g. from before a "Reset / edit lyrics") using an LCS-style diff
  // over line text: lines whose text is unchanged, in the same relative
  // order, keep their tagged time; anything added, removed, or edited comes
  // back as an untagged line rather than wiping every timestamp.
  function reconcileLines(oldLines, newTexts) {
    const oldTexts = oldLines.map((l) => l.text);
    const n = oldTexts.length;
    const m = newTexts.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldTexts[i] === newTexts[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const result = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (oldTexts[i] === newTexts[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
        result.push({ text: newTexts[j], time: oldLines[i].time });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++; // old line dropped
      } else {
        result.push({ text: newTexts[j], time: null }); // new/edited line
        j++;
      }
    }
    while (j < m) {
      result.push({ text: newTexts[j], time: null });
      j++;
    }
    return result;
  }

  startSyncBtn.addEventListener('click', () => {
    const file = audioInput.files[0];
    if (!file) {
      setupError.textContent = 'Choose an audio file first.';
      return;
    }
    const parsedLines = lyricsInput.value
      .split('\n')
      .map(l => l.replace(/\r$/, ''))
      .filter(l => l.trim().length > 0);
    if (parsedLines.length === 0) {
      setupError.textContent = 'Add at least one lyric/marker line.';
      return;
    }
    lines = reconcileLines(lines, parsedLines);
    pointer = lines.findIndex((l) => l.time === null);
    if (pointer === -1) pointer = lines.length;
    audioFileHint = { name: file.name, size: file.size };
    pendingResumeHint = null;
    syncAudio.src = audioObjectUrl;
    enterSyncView();
    saveSession();
  });

  resumeBtn.addEventListener('click', () => {
    const saved = loadSession();
    if (!saved) return;
    lines = saved.lines;
    pointer = saved.pointer;
    pendingResumeHint = saved.audioFileHint || null;
    lyricsInput.value = lines.map(l => l.text).join('\n');
    setupError.textContent = pendingResumeHint
      ? `Session restored — choose "${pendingResumeHint.name}" again, then click "Start syncing".`
      : 'Session restored — choose the same audio file again, then click "Start syncing".';
    resumeBtn.classList.add('hidden');
  });

  // ---------------------------------------------------------------------
  // session persistence (lyrics + timestamps only — audio files can't be
  // persisted across reloads, so the user re-selects the file)
  // ---------------------------------------------------------------------
  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines, pointer, audioFileHint }));
    } catch (e) { /* storage unavailable, ignore */ }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  (function checkForResumableSession() {
    const saved = loadSession();
    if (saved) resumeBtn.classList.remove('hidden');
  })();

  // ---------------------------------------------------------------------
  // sync view
  // ---------------------------------------------------------------------
  function enterSyncView() {
    setupView.classList.add('hidden');
    syncView.classList.remove('hidden');
    exportPanel.classList.remove('hidden');
    undoStack = [];
    redoStack = [];
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
  }

  function exitToSetup() {
    // `lines` is the authoritative, up-to-date text at this point — it may
    // include lines inserted or re-tagged during the sync session that were
    // never written back to the textarea. Resync it here so Start syncing's
    // reconcile (which only ever sees lyricsInput.value) can't silently drop
    // them as "removed" simply because the textarea never caught up.
    lyricsInput.value = lines.map((l) => l.text).join('\n');
    syncView.classList.add('hidden');
    exportPanel.classList.add('hidden');
    setupView.classList.remove('hidden');
    resumeBtn.classList.add('hidden');
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  resetBtn.addEventListener('click', () => {
    if (!confirm('This returns to lyric editing. Lines you don\'t change keep their tagged timestamps; anything you add, remove, or edit will need (re)tagging. Continue?')) return;
    exitToSetup();
  });

  back5Btn.addEventListener('click', () => seekBy(-5));
  back1Btn.addEventListener('click', () => seekBy(-1));

  function seekBy(deltaSeconds) {
    syncAudio.currentTime = Math.max(0, syncAudio.currentTime + deltaSeconds);
  }

  rateSelect.addEventListener('change', () => {
    syncAudio.playbackRate = parseFloat(rateSelect.value);
  });

  syncAudio.addEventListener('timeupdate', () => {
    clockDisplay.textContent = formatTime(syncAudio.currentTime);
  });

  // Clicking the native play/pause button focuses the <audio> element. While
  // it's genuinely playing AND focused, Chrome handles Space as a built-in
  // "toggle playback" browser-chrome shortcut *before any DOM event is ever
  // dispatched* — confirmed by a capture-phase document listener seeing
  // nothing at all when this fires. That's a level below anything
  // preventDefault()/stopPropagation() in page JS can intercept (unlike the
  // in-page shadow-DOM conflict handled above), so the only fix is to never
  // let the control keep focus in the first place.
  syncAudio.addEventListener('focus', () => syncAudio.blur());

  tapBtn.addEventListener('click', tapCurrentLine);
  undoBtn.addEventListener('click', undoLastTap);

  // Snapshot-based undo/redo (Ctrl+Z / Ctrl+Shift+Z) covering the last
  // MAX_HISTORY tap/undo/insert actions. Storing full {lines, pointer}
  // snapshots rather than reversing each action individually keeps every
  // action type (tap, the Backspace undo, inserting a missed line) trivially
  // and correctly undoable/redoable without teaching the history system how
  // to invert each one.
  function cloneLines(arr) {
    return arr.map((l) => ({ text: l.text, time: l.time }));
  }

  function pushHistory() {
    undoStack.push({ lines: cloneLines(lines), pointer });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = []; // a fresh action invalidates whatever redo timeline existed
  }

  function undoHistory() {
    if (undoStack.length === 0) return;
    const prev = undoStack.pop();
    redoStack.push({ lines: cloneLines(lines), pointer });
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    lines = prev.lines;
    pointer = prev.pointer;
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function redoHistory() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    undoStack.push({ lines: cloneLines(lines), pointer });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    lines = next.lines;
    pointer = next.pointer;
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function tapCurrentLine() {
    if (pointer >= lines.length) return;
    pushHistory();
    lines[pointer].time = syncAudio.currentTime;
    // Advance to the next UNTAGGED line, not just pointer+1: after editing
    // lyrics mid-session, reconcileLines() can leave the pointer sitting on
    // an untagged "hole" with already-correctly-tagged lines still ahead of
    // it. Blindly moving one step forward would make the very next tap
    // silently overwrite one of those already-good timestamps.
    let next = pointer + 1;
    while (next < lines.length && lines[next].time !== null) next++;
    pointer = next;
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function undoLastTap() {
    // If the pointer is currently sitting on an already-tagged line (e.g. the
    // user jumped back to re-tag it), clear that one in place. Otherwise fall
    // back to stepping back to the previous line and clearing it.
    const canClearCurrent = pointer < lines.length && lines[pointer].time !== null;
    if (!canClearCurrent && pointer <= 0) return;
    pushHistory();
    if (canClearCurrent) {
      lines[pointer].time = null;
    } else {
      pointer -= 1;
      lines[pointer].time = null;
    }
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function jumpToLine(index) {
    pointer = index;
    if (lines[index].time !== null) {
      syncAudio.currentTime = lines[index].time;
    }
    updateCurrentLineDisplay();
    renderLines();
  }

  function updateCurrentLineDisplay() {
    if (pointer >= lines.length) {
      const untaggedCount = lines.filter((l) => l.time === null).length;
      currentLineText.textContent = untaggedCount > 0
        ? `${untaggedCount} line(s) above still need tagging — click one to jump there.`
        : 'All lines tagged — check the export below.';
      tapBtn.disabled = true;
    } else {
      currentLineText.textContent = lines[pointer].text;
      tapBtn.disabled = false;
    }
    const currentLineIsTagged = pointer < lines.length && lines[pointer].time !== null;
    undoBtn.disabled = !(currentLineIsTagged || pointer > 0);
  }

  // Insert a missed/repeated line right after `index` without touching any
  // other line's text or timestamp — so realizing mid-sync that a line was
  // left out of the list doesn't mean re-tagging everything from scratch.
  function insertLineAfter(index) {
    const refText = lines[index].text;
    const text = prompt(`Insert a new line after "${refText}":`, '');
    if (text === null) return; // cancelled
    const trimmed = text.trim();
    if (!trimmed) return;
    pushHistory();
    lines.splice(index + 1, 0, { text: trimmed, time: null });
    if (pointer > index) pointer += 1;
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function renderLines() {
    linesList.innerHTML = '';
    lines.forEach((line, index) => {
      const li = document.createElement('li');
      li.className = (line.time !== null ? 'tagged ' : '') + (index === pointer ? 'current' : '');
      const time = document.createElement('span');
      time.className = 'line-time';
      time.textContent = line.time !== null ? formatTime(line.time) : '--:--.---';
      const text = document.createElement('span');
      text.className = 'line-text';
      text.textContent = line.text;
      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'insert-line-btn';
      insertBtn.title = 'Insert a missed line after this one';
      insertBtn.textContent = '+';
      insertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        insertLineAfter(index);
      });
      li.appendChild(time);
      li.appendChild(text);
      li.appendChild(insertBtn);
      li.addEventListener('click', () => jumpToLine(index));
      linesList.appendChild(li);
    });
    // keep the current line scrolled into view
    const currentEl = linesList.children[pointer];
    if (currentEl) currentEl.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------------
  // keyboard shortcuts (ignored while typing in an input/textarea)
  //
  // Registered on the CAPTURE phase so this runs before the native <audio
  // controls> UI gets the event. Once you click that control's play/pause
  // button it holds keyboard focus, and the browser's own media-controls
  // handler treats Space as "toggle play" and swallows it (stopping it from
  // ever reaching a bubble-phase listener) — which is why Space would only
  // work again after clicking elsewhere on the page. Capturing first, and
  // stopping propagation ourselves, means the native control never sees it.
  // ---------------------------------------------------------------------
  const SYNC_KEY_CODES = new Set(['Space', 'Backspace', 'ArrowLeft', 'ArrowRight', 'KeyP', 'KeyZ', 'KeyY']);

  function shouldHandleSyncKey(e) {
    if (syncView.classList.contains('hidden')) return false;
    if (lyricVideoOpen) return false; // the lyric-video overlay owns keyboard input while open
    if (!SYNC_KEY_CODES.has(e.code)) return false;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  }

  document.addEventListener('keydown', (e) => {
    if (!shouldHandleSyncKey(e)) return;

    const isUndoCombo = e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey;
    const isRedoCombo = (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.code === 'KeyY' && (e.ctrlKey || e.metaKey));
    // A bare "z"/"y" (no Ctrl/Cmd) isn't one of our shortcuts — leave it alone.
    if ((e.code === 'KeyZ' || e.code === 'KeyY') && !isUndoCombo && !isRedoCombo) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Space') {
      tapCurrentLine();
    } else if (e.code === 'Backspace') {
      undoLastTap();
    } else if (e.code === 'ArrowLeft') {
      seekBy(-1);
    } else if (e.code === 'ArrowRight') {
      seekBy(1);
    } else if (e.code === 'KeyP') {
      if (syncAudio.paused) syncAudio.play(); else syncAudio.pause();
    } else if (isUndoCombo) {
      undoHistory();
    } else if (isRedoCombo) {
      redoHistory();
    }
  }, true);

  // Also swallow the matching keyup: the native control activates a
  // focused button on the Space *keyup* (per the button activation spec),
  // so blocking only keydown isn't enough to stop it from toggling playback.
  document.addEventListener('keyup', (e) => {
    if (!shouldHandleSyncKey(e)) return;
    if ((e.code === 'KeyZ' || e.code === 'KeyY') && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // ---------------------------------------------------------------------
  // export
  // ---------------------------------------------------------------------
  function buildExportText() {
    return lines
      .filter(l => l.time !== null)
      .map(l => `${formatTime(l.time)} — ${l.text}`)
      .join('\n');
  }

  function renderExport() {
    exportOutput.value = buildExportText();
  }

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportOutput.value);
      copyStatus.textContent = 'Copied!';
    } catch (e) {
      exportOutput.select();
      const fallbackOk = document.execCommand('copy');
      copyStatus.textContent = fallbackOk ? 'Copied!' : 'Copy failed — select the text and copy manually.';
    }
    setTimeout(() => { copyStatus.textContent = ''; }, 2000);
  });

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([exportOutput.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synced-lyrics.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Deferred rather than immediate: some WebKit/Blink versions can abort an
    // in-flight download if the blob URL is revoked the instant click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ---------------------------------------------------------------------
  // Storyboarder (wonderunit/storyboarder) project export.
  //
  // A .storyboarder project is a JSON file plus a sibling images/ folder
  // holding a real PNG per board (board-{n}-{uid}.png) — the schema and an
  // official example project were checked directly against
  // github.com/wonderunit/storyboarder to get field names/types right.
  // Since we have no artwork, each board gets a blank placeholder PNG so the
  // project opens cleanly with nothing missing; the lyric line becomes both
  // the board's dialogue and notes, timed/duration-matched from the taps.
  // ---------------------------------------------------------------------
  const ZIP_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function toDosDateTime(date) {
    const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
    const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
    return { dosTime, dosDate };
  }

  // Minimal "store" (uncompressed) ZIP writer — no third-party dependency,
  // readable by any standard unzip tool. No compression needed for a handful
  // of small placeholder PNGs and one JSON file.
  function buildZip(entries) {
    const encoder = new TextEncoder();
    const { dosTime, dosDate } = toDosDateTime(new Date());
    const fileParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = entry.data;
      const crc = crc32(data);
      const size = data.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true); // compression: store
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      fileParts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const centralOffset = offset;
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);

    return new Blob([...fileParts, ...centralParts, eocd], { type: 'application/zip' });
  }

  function makeBlankBoardPng(width, height) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = Math.max(2, Math.round(width * 0.003));
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('canvas.toBlob failed')); return; }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      }, 'image/png');
    });
  }

  function randomBoardUid(used) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let uid;
    do {
      uid = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (used.has(uid));
    used.add(uid);
    return uid;
  }

  exportStoryboarderBtn.addEventListener('click', async () => {
    const tagged = lines.filter((l) => l.time !== null).slice().sort((a, b) => a.time - b.time);
    if (tagged.length === 0) {
      alert('Tag at least one line before exporting a Storyboarder project.');
      return;
    }

    const originalLabel = exportStoryboarderBtn.textContent;
    exportStoryboarderBtn.disabled = true;
    exportStoryboarderBtn.textContent = 'Building…';
    try {
      const file = audioInput.files[0];
      const baseName = file ? file.name.replace(/\.[^.]+$/, '') : 'storyboard';
      const slug = baseName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'storyboard';

      const usedUids = new Set();
      const totalDuration = Number.isFinite(syncAudio.duration) ? syncAudio.duration : null;

      const boards = tagged.map((line, i) => {
        const uid = randomBoardUid(usedUids);
        const timeMs = Math.round(line.time * 1000);
        const nextTimeMs = i + 1 < tagged.length ? Math.round(tagged[i + 1].time * 1000) : null;
        const durationMs =
          nextTimeMs !== null
            ? Math.max(200, nextTimeMs - timeMs)
            : totalDuration !== null
              ? Math.max(200, Math.round((totalDuration - line.time) * 1000))
              : 2000;
        return {
          uid,
          url: `board-${i + 1}-${uid}.png`,
          newShot: true,
          lastEdited: Date.now(),
          number: i + 1,
          shot: String(i + 1),
          time: timeMs,
          duration: durationMs,
          dialogue: line.text,
          notes: line.text,
          lineMileage: 0,
        };
      });

      const project = {
        version: '0.8.0',
        aspectRatio: 1.7777778,
        fps: 24,
        defaultBoardTiming: '2000',
        boards,
      };

      const blankPng = await makeBlankBoardPng(1600, 900);
      const entries = [
        { name: `${slug}/${slug}.storyboarder`, data: new TextEncoder().encode(JSON.stringify(project, null, 2)) },
        ...boards.map((b) => ({ name: `${slug}/images/${b.url}`, data: blankPng })),
      ];
      const zipBlob = buildZip(entries);

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-storyboarder.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Deferred rather than immediate — see the same note on the .txt download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      exportStoryboarderBtn.disabled = false;
      exportStoryboarderBtn.textContent = originalLabel;
    }
  });

  // ---------------------------------------------------------------------
  // Fullscreen lyric video: watch the track with the lyrics animating in
  // sync, cover art (if the file has any) on one side, karaoke-style.
  // ---------------------------------------------------------------------
  function getTaggedLinesSorted() {
    return lines.filter((l) => l.time !== null).slice().sort((a, b) => a.time - b.time);
  }

  function formatClock(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return '00:00';
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // Average the (opaque) pixels of a small downscaled copy of the art to get
  // a representative color, used to tint the overlay's background/glow so
  // it feels themed to the track rather than generically dark.
  function extractDominantColor(imgEl) {
    try {
      const size = 24;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue; // skip transparent pixels
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      if (!count) return null;
      return `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
    } catch (e) {
      return null; // never let a color-tint failure break the viewer
    }
  }

  function renderLyricVideoLyrics() {
    lyricVideoLines = getTaggedLinesSorted();
    lyricVideoLyrics.innerHTML = '';
    lyricVideoLines.forEach((line) => {
      const div = document.createElement('div');
      div.className = 'lv-line';
      div.textContent = line.text;
      lyricVideoLyrics.appendChild(div);
    });
  }

  function updateLyricVideoActiveLine() {
    if (!lyricVideoLines.length) return;
    const t = syncAudio.currentTime;
    let activeIdx = -1;
    for (let i = 0; i < lyricVideoLines.length; i++) {
      if (lyricVideoLines[i].time <= t) activeIdx = i;
      else break;
    }
    const children = lyricVideoLyrics.children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle('lv-current', i === activeIdx);
      children[i].classList.toggle('lv-past', i < activeIdx);
    }
    if (activeIdx >= 0 && children[activeIdx]) {
      children[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function updateLvPlayIcon() {
    lvPlayBtn.innerHTML = syncAudio.paused ? '&#9654;' : '&#10074;&#10074;';
  }

  function openLyricVideo() {
    const tagged = getTaggedLinesSorted();
    if (tagged.length === 0) {
      alert('Tag at least one line before opening the lyric view.');
      return;
    }
    renderLyricVideoLyrics();

    if (coverArtUrl) {
      lyricVideoCoverImg.src = coverArtUrl;
      lyricVideoCoverImg.classList.remove('hidden');
      lyricVideoArtFallback.classList.add('hidden');
      lyricVideoCoverImg.onload = () => {
        const tint = extractDominantColor(lyricVideoCoverImg);
        lyricVideoOverlay.style.setProperty('--lv-tint', tint || '#7c9bff');
      };
    } else {
      lyricVideoCoverImg.classList.add('hidden');
      lyricVideoArtFallback.classList.remove('hidden');
      lyricVideoOverlay.style.setProperty('--lv-tint', '#7c9bff');
    }

    const file = audioInput.files[0];
    lyricVideoTitleEl.textContent = trackTitle || (file ? file.name.replace(/\.[^.]+$/, '') : 'Untitled');
    lyricVideoArtistEl.textContent = trackArtist || '';
    lyricVideoArtistEl.classList.toggle('hidden', !trackArtist);

    const dur = syncAudio.duration;
    lvSeek.max = String(Number.isFinite(dur) ? Math.round(dur * 1000) : 1000);
    lvTimeTotal.textContent = formatClock(dur);
    lvSeek.value = String(Math.round(syncAudio.currentTime * 1000));
    lvTimeCurrent.textContent = formatClock(syncAudio.currentTime);
    updateLvPlayIcon();
    updateLyricVideoActiveLine();

    lyricVideoOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    lyricVideoOpen = true;
  }

  function closeLyricVideo() {
    lyricVideoOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    lyricVideoOpen = false;
    syncAudio.pause();
  }

  openLyricVideoBtn.addEventListener('click', openLyricVideo);
  closeLyricVideoBtn.addEventListener('click', closeLyricVideo);
  lyricVideoOverlay.addEventListener('click', (e) => {
    if (e.target === lyricVideoOverlay) closeLyricVideo();
  });

  lvPlayBtn.addEventListener('click', () => {
    if (syncAudio.paused) syncAudio.play(); else syncAudio.pause();
  });

  lvSeek.addEventListener('input', () => {
    isDraggingLvSeek = true;
    const t = parseFloat(lvSeek.value) / 1000;
    syncAudio.currentTime = t;
    lvTimeCurrent.textContent = formatClock(t);
    updateLyricVideoActiveLine();
  });
  lvSeek.addEventListener('change', () => {
    isDraggingLvSeek = false;
  });

  syncAudio.addEventListener('play', () => {
    updateLvPlayIcon();
    lyricVideoArt.classList.add('is-playing');
    lyricVideoArtFallback.classList.add('is-playing');
  });
  syncAudio.addEventListener('pause', () => {
    updateLvPlayIcon();
    lyricVideoArt.classList.remove('is-playing');
    lyricVideoArtFallback.classList.remove('is-playing');
  });
  syncAudio.addEventListener('timeupdate', () => {
    if (!lyricVideoOpen) return;
    if (!isDraggingLvSeek) lvSeek.value = String(Math.round(syncAudio.currentTime * 1000));
    lvTimeCurrent.textContent = formatClock(syncAudio.currentTime);
    updateLyricVideoActiveLine();
  });

  document.addEventListener('keydown', (e) => {
    if (!lyricVideoOpen) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      closeLyricVideo();
    } else if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      if (syncAudio.paused) syncAudio.play(); else syncAudio.pause();
    }
  }, true);
  document.addEventListener('keyup', (e) => {
    if (!lyricVideoOpen) return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
