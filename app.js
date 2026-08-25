(() => {
  'use strict';

  const STORAGE_KEY = 'synced-lyric-extractor-session-v1';

  // ---- state ----
  let lines = [];        // [{ text, time }]  time = seconds|null
  let pointer = 0;       // index of the "next line to tag"
  let audioObjectUrl = null;

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

  // ---------------------------------------------------------------------
  // time formatting: "MM:SS.mmm" matching the requested output style
  // ---------------------------------------------------------------------
  function formatTime(totalSeconds) {
    const clamped = Math.max(0, totalSeconds);
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped - minutes * 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = seconds.toFixed(3).padStart(6, '0');
    return `${mm}:${ss}`;
  }

  // ---------------------------------------------------------------------
  // setup view
  // ---------------------------------------------------------------------
  audioInput.addEventListener('change', () => {
    const file = audioInput.files[0];
    if (!file) return;
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = URL.createObjectURL(file);
    previewAudio.src = audioObjectUrl;
    previewAudio.style.display = 'block';
    audioFilename.textContent = file.name;
    updateStartButton();
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
    lines = parsedLines.map(text => ({ text, time: null }));
    pointer = 0;
    syncAudio.src = audioObjectUrl;
    enterSyncView();
    saveSession();
  });

  resumeBtn.addEventListener('click', () => {
    const saved = loadSession();
    if (!saved) return;
    lines = saved.lines;
    pointer = saved.pointer;
    lyricsInput.value = lines.map(l => l.text).join('\n');
    setupError.textContent = 'Session restored — choose the same audio file again, then click "Start syncing".';
    resumeBtn.style.display = 'none';
  });

  // ---------------------------------------------------------------------
  // session persistence (lyrics + timestamps only — audio files can't be
  // persisted across reloads, so the user re-selects the file)
  // ---------------------------------------------------------------------
  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines, pointer }));
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
    if (saved) resumeBtn.style.display = 'inline-block';
  })();

  // ---------------------------------------------------------------------
  // sync view
  // ---------------------------------------------------------------------
  function enterSyncView() {
    setupView.style.display = 'none';
    syncView.style.display = 'block';
    exportPanel.style.display = 'block';
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
  }

  function exitToSetup() {
    syncView.style.display = 'none';
    exportPanel.style.display = 'none';
    setupView.style.display = 'block';
    resumeBtn.style.display = 'none';
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  resetBtn.addEventListener('click', () => {
    if (!confirm('This clears all tagged timestamps and returns to lyric editing. Continue?')) return;
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

  tapBtn.addEventListener('click', tapCurrentLine);
  undoBtn.addEventListener('click', undoLastTap);

  function tapCurrentLine() {
    if (pointer >= lines.length) return;
    lines[pointer].time = syncAudio.currentTime;
    pointer = Math.min(pointer + 1, lines.length);
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function undoLastTap() {
    // step back to the most recent tagged line and clear it
    let idx = pointer - 1;
    if (idx < 0) return;
    lines[idx].time = null;
    pointer = idx;
    renderLines();
    updateCurrentLineDisplay();
    renderExport();
    saveSession();
  }

  function jumpToLine(index) {
    pointer = index;
    updateCurrentLineDisplay();
    renderLines();
  }

  function updateCurrentLineDisplay() {
    if (pointer >= lines.length) {
      currentLineText.textContent = 'All lines tagged — check the export below.';
      tapBtn.disabled = true;
    } else {
      currentLineText.textContent = lines[pointer].text;
      tapBtn.disabled = false;
    }
    undoBtn.disabled = pointer <= 0 && !(pointer < lines.length && lines[pointer].time !== null);
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
      li.appendChild(time);
      li.appendChild(text);
      li.addEventListener('click', () => jumpToLine(index));
      linesList.appendChild(li);
    });
    // keep the current line scrolled into view
    const currentEl = linesList.children[pointer];
    if (currentEl) currentEl.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------------
  // keyboard shortcuts (ignored while typing in an input/textarea)
  // ---------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (syncView.style.display === 'none') return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      tapCurrentLine();
    } else if (e.code === 'Backspace') {
      e.preventDefault();
      undoLastTap();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      seekBy(-1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      seekBy(1);
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      if (syncAudio.paused) syncAudio.play(); else syncAudio.pause();
    }
  });

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
      document.execCommand('copy');
      copyStatus.textContent = 'Copied!';
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
    URL.revokeObjectURL(url);
  });
})();
