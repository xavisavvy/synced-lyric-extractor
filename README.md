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
- **Undo/redo history** — Ctrl+Z / Ctrl+Shift+Z step back and forward through your last 25 taps, undos, and inserted lines.
- **Insert a missed line** inline, and **Reset / edit lyrics** without losing already-tagged timestamps for lines you don't touch.
- **Fullscreen lyric view** — a karaoke-style preview with the embedded cover art (if the file has one) on one side and the lyrics animating in sync on the other; falls back to an animated equalizer when there's no art, and tints itself from the art's dominant color.
- **Copy, download, or export a Storyboarder project** (`.zip`, ready to open in [Storyboarder](https://wonderunit.com/storyboarder/)) from the tagged result.

## Prerequisites

None — it's plain HTML/CSS/JS with no build step and no dependencies. Nothing below is required just to open the app.

## Usage

**Option A — try it hosted, zero setup:** https://xavisavvy.github.io/synced-lyric-extractor/

**Option B — open the file directly:** double-click [`index.html`](index.html), or open it via your browser's File → Open.

**Option C — serve it over `http://` instead of `file://`** (occasionally useful, since some browsers restrict certain behavior on `file://` pages). Pick whichever of these you already have installed — any one is enough, no need for more than one:

| Tool | Command |
|---|---|
| Python 3 | `python -m http.server 8420` |
| Node.js | `npx serve -l 8420` (or `npx http-server -p 8420`) |
| PHP | `php -S localhost:8420` |
| Ruby | `ruby -run -e httpd . -p 8420` |
| VS Code | install the "Live Server" extension, then right-click `index.html` → **Open with Live Server** |

Then visit `http://localhost:8420` (or whatever port/URL the tool prints).

Once it's open, however you got there:

1. Choose an audio file and enter your lyric/marker lines (one per line — whatever you type is exactly what gets exported).
2. Click **Start syncing**, play the track, and tap Space in time with each line.
3. Copy or download the result from the export panel.

## How it works

Everything runs in the browser: audio playback via the native `<audio>` element, lyric timing recorded from `currentTime` on tap, and export built as a plain string. There's no backend, no network calls, and no third-party dependencies — your audio file and lyrics never leave your machine.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

[MIT](LICENSE)
