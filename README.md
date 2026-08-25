# Synced Lyric Extractor

A small, dependency-free web app for tapping out lyric timing against an mp3 and exporting video-editor-ready timecodes.

Load a song and a list of lyric/marker lines, tap along in time with the beat, and export a plain-text file like:

```
00:00.000 — instrumental begins
00:12.400 — "High up in the smoke"
00:18.200 — "Loot bag on my back"
```

## Features

- **Tap-to-sync** — play the track and hit Space in time with each line; Backspace undoes the last tap.
- **Click any line to re-tag it** — jump back and re-tap a mistimed line without starting over.
- **Embedded lyrics detection** — if the mp3's ID3v2 tag already has `USLT` (plain lyrics) or `SYLT` (pre-synced lyrics) frames, the app offers to load them automatically, editable before you proceed.
- **Adjustable playback speed** and 1s/5s rewind, for tricky sections.
- **Autosave** — lyrics and tagged timestamps are saved to `localStorage` as you go, so a reload won't lose your progress (you'll just need to re-pick the audio file).
- **Copy or download** the final timecoded text.

## Usage

No build step, no install, no server required.

1. Open [`index.html`](index.html) directly in a browser, **or** serve the folder with any static file server, e.g.:

   ```bash
   python -m http.server 8420
   ```

   then visit `http://localhost:8420`.
2. Choose an audio file and enter your lyric/marker lines (one per line — whatever you type is exactly what gets exported).
3. Click **Start syncing**, play the track, and tap Space in time with each line.
4. Copy or download the result from the export panel.

## How it works

Everything runs in the browser: audio playback via the native `<audio>` element, lyric timing recorded from `currentTime` on tap, and export built as a plain string. There's no backend, no network calls, and no third-party dependencies — your audio file and lyrics never leave your machine.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

[MIT](LICENSE)
