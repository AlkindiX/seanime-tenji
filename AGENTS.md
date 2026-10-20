# Seanime Tenji: guide for coding agents

Seanime Tenji is the mobile and TV client for a [Seanime](https://github.com/5rahim/seanime)
server (a self-hosted anime/manga media server). One Expo / React Native codebase builds:

| Target | How | Player |
| --- | --- | --- |
| Android, iOS (phone) | Expo native builds | libmpv (`modules/expo-mpv-player`) |
| Android TV, tvOS | react-native-tvos (`EXPO_TV=1`) | libmpv |
| **LG webOS TV** | the TV UI as a web app via react-native-web (`SEANIME_WEBOS=1`), packaged as an `.ipk` | HTML5 `<video>` (`MpvPlayerView.web.tsx`) |

Most recent work is on **webOS**; `webos/README.md` is its user-facing reference and
lists what is not yet verified on a real TV.

## Where things are

```
app/                      expo-router routes; each screen branches on Platform.isTV
  (app)/(media)/player.tsx  the player screen (phone + TV), TV remote keys, panels
  (out)/set-server-url.tsx  server URL + password setup
src/api/
  generated/              endpoints.ts + types.ts, generated from the Seanime server. DO NOT EDIT
  hooks/*.hooks.ts        react-query hooks per server area (useServerQuery / useServerMutation)
  client/requests.ts      buildSeaQuery: fetch, auth headers, error shape (SeaError)
  client/server-auth.ts   password hash header, HMAC ?token= for URLs (signed per path)
  components/             WebSocket provider + hub (publish/subscribe, sendWsMessage), server wrapper
src/components/
  tv/                     every TV screen and widget (tv-*.tsx); sizes via tvSize()/TV in tv-scale.ts
  features/               phone screens' building blocks (player, torrentstream, media, ...)
src/lib/
  player/                 playback: session.ts (WS events -> source), use-mpv-player.ts (view bridge),
                          web-playback-plan.web.ts (webOS: direct play vs transcode, subs, fonts),
                          server-playback.ts (webOS torrent/debrid via the server's "nativeplayer"
                          pipeline: streamed MKV subtitles, VideoCore client events),
                          player-preferences.ts (MMKV-backed prefs)
  webos/                  the webOS platform layer (see below)
  offline/                offline mode, mutation queue, local snapshots
src/atoms/                jotai atoms (server URL/token in MMKV via atoms/storage.ts)
modules/expo-mpv-player/  player module: native mpv + web/ (web-video-player.ts, subtitles.ts,
                          libass.ts = JASSUB/libass for ASS), subtitle-feed.ts (live subtitle tracks)
webos/                    build.mjs (export -> lower JS/CSS for Chromium 79 -> polyfills -> JASSUB -> .ipk),
                          jassub.mjs, appinfo.json, README.md
tests/*.test.ts           node:test unit tests (pure modules only)
```

### Find it fast

| Task | Start here |
| --- | --- |
| A TV screen's layout or focus | `src/components/tv/tv-<screen>.tsx`, focus visuals in `tv-focus.tsx` |
| D-pad focus, scrolling to the focused card | `src/lib/webos/spatial-navigation.ts`, `scroll-animator.ts` |
| Remote keys, Magic Remote pointer, wheel, drag, Back | `src/lib/webos/remote.ts`, `remote-input.ts` |
| Player keys/shortcuts on TV | `useTVEventHandler` + `handleRemoteShortcut` in `app/(app)/(media)/player.tsx` |
| What the webOS player plays (codecs, transcode, subs) | `src/lib/player/web-playback-plan.web.ts`, `src/lib/webos/playback-capabilities.ts` |
| Torrent/debrid stream start | `src/components/features/torrentstream/use-torrent-stream-controller.ts` (`STREAM_PLAYBACK_TYPE`) |
| Stream WS events -> player source | `usePlayerEventListener` in `src/lib/player/session.ts` |
| Subtitle rendering on webOS | `modules/expo-mpv-player/src/web/` (`web-video-player.ts`, `subtitles.ts`, `libass.ts`) |
| Server endpoint or type | `grep -n "<Name>" src/api/generated/endpoints.ts src/api/generated/types.ts` |
| Server-side behaviour | the Seanime repo at the matching tag, e.g. `gh api repos/5rahim/seanime/contents/<path>?ref=v3.10.4` |

## The webOS layer (`src/lib/webos`)

- `metro.config.js` (when `SEANIME_WEBOS=1`) resolves `react-native` to
  `react-native-tv.tsx`: react-native-web plus react-native-tvos APIs (TVFocusGuideView,
  useTVEventHandler, hasTVPreferredFocus) and overrides (`overrides/*`: Platform.isTV = true,
  BackHandler, Modal, Pressable...). Native-only packages map to `stubs/`.
- Focus is ours: `spatial-navigation.ts` picks the next element geometrically (Android
  FocusFinder rules) and honours guide options (trapFocus*, autoFocus, destinations).
- The packaged app runs from `file://`: requests send `Origin: null` (the server needs a
  password), `fetch()` of local files fails (use XHR, see `web/libass.ts`), workers
  load from blob URLs, and `install.ts` keeps the document URL fixed while routing.
- Target browsers: webOS 6 = Chromium 79 (build target), webOS 22 = 87, webOS 23 (LG C3) = 94.
  `webos/build.mjs` lowers JS/CSS and adds core-js polyfills; `css-compat.ts` covers CSS gaps.
- `Platform.OS === "web"` means webOS in this repo; `Platform.isTV` is true there too.

## Commands

```bash
npm install                 # see "Install" gotcha below
npm test                    # node:test, tests/*.test.ts (~60 tests, a few seconds)
npx tsc --noEmit -p .       # typecheck; app/_layout.tsx global.css TS2882 is pre-existing, ignore it
npm run build:webos         # -> dist/webos/app/ and dist/webos/app.seanime.tenji_<v>_all.ipk (~2-3 min)
npm run serve:webos         # serves dist/webos/app on :8090 for a desktop browser (routes + relative assets handled)
npm run dev:webos           # dev server on :8083 (TV UI in Chrome at 1920x1080; arrows/Enter/Esc = remote)
```

In a browser, set the viewport to 1920x1080 and point the app at a server (the saved
URL is `localStorage["seanime-mobile\\sea-server-url"]`, JSON-encoded). There is no lint
script; match the surrounding style.

## Conventions

- TypeScript, 4-space indent, double quotes, no semicolons, trailing commas in multi-line.
- Comments explain why, briefly, in plain sentences; keep them in the style of the file.
- TV UI sizes go through `tvSize()` / `TV` constants; text and icons need `accessibilityLabel`
  (webOS Audio Guidance reads it).
- webOS-only behaviour is gated with `Platform.OS === "web"`; don't change Android TV / tvOS
  behaviour unless asked.
- Commits: one topic each, subject like `webOS: <what changed>`; end with the attribution
  line the session asks for. Update `webos/README.md` when webOS behaviour changes.
- Unit-test pure modules (no react-native imports) by importing the `.ts` file directly
  from `tests/`; node runs them with `--experimental-strip-types`.

## Gotchas

- **Install:** `expo@58.0.16` depends on an unpublished `@expo/cli`; if `npm install` fails
  with ETARGET, run `npm install --no-save expo@58.0.15`. Don't change the `expo` range.
- **Build crash:** `expo export` sometimes segfaults on exit (Node, Windows) after writing
  everything; `build.mjs` then fails. Just run it again.
- **`overflow: "visible"`** on a horizontal FlatList kills scrolling on webOS (inline style
  beats react-native-web's `overflowX: auto`). Use `ROW_OVERFLOW` from `tv-scale.ts`.
- **Scrolling:** use `animateScroll` (`scroll-animator.ts`), not `scrollBy({behavior:"smooth"})`,
  which restarts on every key repeat and shakes.
- **React Native Web `Alert.alert` does nothing**; give webOS a direct path.
- **Terser miscompile:** in a React Compiler-processed effect, `const prev = moduleVar;
  moduleVar = next; if (prev ...)` was minified into reads of `moduleVar` after the
  update (dev worked, release didn't). Decide first, then update module state. Check
  suspicious code in `dist/webos/www/_expo/static/js/web/index-*.js` (Metro's output).
- **`className` views may not forward `ref`** (Uniwind wrapper); use `style` on a View
  whose DOM node you need.
- **Server quirks** worth knowing: no password -> every `Origin: null` request is
  `403 "...trusted local origin"`; MKV subtitle events carry times in ms and no ReadOrder;
  HMAC tokens are checked against the request path.
- The in-app browser pane may be hidden, which pauses `requestAnimationFrame`; time and
  screenshot in headless Edge over the DevTools protocol instead (with
  `Emulation.setCPUThrottlingRate` ~6 to approximate a TV, `Profiler` for CPU profiles,
  and an unminified export: `expo export --platform web --no-minify` with the webOS env).

## webOS performance notes

- Focus scale is a CSS transition on webOS (`useTVFocus`, `TVFocusScaleView` in
  `tv-focus.tsx`); never animate per frame in JS there.
- Horizontal rows of fixed-size cards pass `getItemLayout` (`MEDIA_ROW_LAYOUT`,
  `EPISODE_ROW_LAYOUT` in `tv-scale.ts`) so FlatList doesn't measure every cell.
- Per-media atoms are rebuilt with `reuseEqualEntries` so a refetch only re-renders cards
  whose data changed; cards read narrow status atoms (`useMediaCardSettings`).
- Screen transitions (`tv-screen-transition.tsx`) and the nav fade (`tv-nav-scrim.tsx`)
  use the Web Animations API / static gradients: opacity and transform only.

## Working with the user

- **Ask before anything touches the user's real Seanime server** (192.168.68.60:43211),
  even read-only browsing, and say what it will do. Never start playback/streams or change
  server data without an explicit yes. A throwaway server (`seanime-server-windows.exe
  --datadir <scratch> --port 43299`) is fine for protocol checks.
- Don't commit or push unless asked; the user tests builds on their LG C3 (webOS 23) first.
- Explain fixes in plain words; the user is not reading diffs.
