# Contributing

Thanks for considering a contribution to Synced Lyric Extractor.

## Project philosophy

This is intentionally a small, dependency-free, client-side-only tool: plain HTML/CSS/JS, no build step, no framework, no third-party libraries. Please keep contributions in that spirit — if a change seems to require a new dependency or a build pipeline, open an issue to discuss it first, since that's a significant departure from how the project is structured today.

## Getting set up

There's nothing to install. Either:

- Open [`index.html`](index.html) directly in a browser, or
- Serve the folder with any static file server, e.g. `python -m http.server 8420`.

## Making changes

1. Fork the repo and create a branch for your change.
2. Keep changes focused — a single fix or feature per pull request is easier to review than a bundle of unrelated changes.
3. Test manually in a browser before opening a PR: exercise the golden path (load audio + lyrics, tap through, export) and any edge case your change touches. There's no automated test suite yet, so this is the verification that matters.
4. Match the existing code style: no build tooling, `textContent` (never `innerHTML`) for any user-supplied string, and comments only where the *why* isn't obvious from the code itself.
5. Open a pull request describing what changed and why, and how you tested it.

## Reporting bugs

Open a GitHub issue with steps to reproduce, what you expected, and what happened instead. Screenshots or a sample lyrics file are helpful if the bug is visual or data-dependent.

## Reporting security issues

Please don't open a public issue for security vulnerabilities — see [SECURITY.md](SECURITY.md) instead.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you're expected to uphold it.
