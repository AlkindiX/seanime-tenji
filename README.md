# Seanime Tenji for LG webOS: test build

Built from `main` at 4badd79. **Experimental**: tested in desktop Chromium and Chromium 79, not yet on a real TV.

**Download:** [app.seanime.tenji_0.3.0_all.ipk](https://github.com/AlkindiX/seanime-tenji/raw/webos-builds/app.seanime.tenji_0.3.0_all.ipk) (SHA-256 in `SHA256SUMS`)

## Supported TVs

| webOS | LG TV model year | Status |
|---|---|---|
| webOS 25 | 2025 | Supported |
| webOS 24 | 2024 | Supported |
| webOS 23 | 2023 | Supported |
| webOS 22 | 2022 | Supported (recommended minimum) |
| webOS 6.x | 2021 | Supported; some spacing is tighter (no flexbox `gap`) |
| webOS 5.x and older | 2020 and earlier | Not supported |

Check your TV under **Settings → General → About This TV** (or **Support → TV Information**).

## Install

1. On the TV, install LG's **Developer Mode** app from the LG Content Store, sign in with an LG developer account and turn Developer Mode on (the TV restarts).
2. Install the `.ipk` with either:
   - [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) (desktop app): add the TV, then drag the `.ipk` in; or
   - the webOS CLI: `npm install -g @webos-tools/cli`, `ares-setup-device`, then
     `ares-install --device tv app.seanime.tenji_0.3.0_all.ipk`.
   Rooted TVs can install it from the Homebrew Channel instead.
3. **Set a password on your Seanime server** (server settings, or `[server] password = "..."` in `config.toml`). The TV app is refused without one.

Developer Mode sessions expire after a while; extend the session in the Developer Mode app.
