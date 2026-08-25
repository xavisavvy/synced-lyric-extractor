# Security Policy

## Supported versions

This project doesn't maintain multiple release lines — security fixes are made against the `main` branch only. Please make sure you're using the latest version before reporting an issue.

## Scope

Synced Lyric Extractor is a static, client-side-only web app: plain HTML/CSS/JS with no backend, no server-side processing, no third-party dependencies, and no network calls. Audio files and lyrics you load never leave your browser. Given that, the realistic security surface is narrow — things like:

- Cross-site scripting (XSS) via lyric text, filenames, or any other user-supplied input.
- Issues in the parsing of untrusted files (audio files, ID3 tag data, uploaded `.txt` lyric files).
- Anything that could exfiltrate data from the page (there should be none — there are no network requests by design).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use one of these private channels:

1. **Preferred:** [GitHub Security Advisories](../../security/advisories/new) for this repository ("Report a vulnerability" under the Security tab), or
2. Email **xavierproductions05@gmail.com** with a description of the issue, steps to reproduce, and any relevant sample files.

Please include:

- What you found and where (file/line if known).
- Steps to reproduce, or a minimal example.
- The impact you believe it has.

We'll acknowledge reports as promptly as we can and follow up once a fix is available. Since this is a small, dependency-free project maintained outside of working hours, response times may vary — thank you for your patience.
