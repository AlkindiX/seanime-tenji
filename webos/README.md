# Seanime Tenji for LG webOS

LG TVs can't run Android apps, so the webOS build is the TV interface rendered with
React Native Web and packaged as a webOS web app (`.ipk`). It uses the same screens as
Android TV and tvOS. The remote works the same way, with D-pad focus, Back, OK and the
media keys; the Magic Remote pointer also works.

**Status: experimental.** It has been exercised in desktop Chromium, not yet on a TV.

## Requirements

- **webOS 6.0 (2021 models) or newer.** webOS 22 or newer is recommended; webOS 6 lacks
  CSS flexbox `gap`, so some spacing will be tighter.
- **A server password on your Seanime server.** A packaged webOS app runs from
  `file://`, so the browser marks its requests `Origin: null`. Without a password the
  server rejects them to protect against requests from websites. With a password set,
  Tenji authenticates every request. Set one in the server settings or in `config.toml`:

  ```toml
  [server]
  password = "your password"
  ```

## Installing

Build the package from the repository root:

```bash
npm install
npm run build:webos
```

This writes `dist/webos/app.seanime.tenji_<version>_all.ipk`. Install it in any of these
ways:

- **Developer Mode:** install LG's *Developer Mode* app on the TV, then use
  [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
  (`npm install -g @webos-tools/cli`):
  ```bash
  ares-setup-device                      # add the TV once
  ares-install --device tv dist/webos/app.seanime.tenji_*.ipk
  ares-launch --device tv app.seanime.tenji
  ```
- **[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop):** a desktop
  app that installs `.ipk` files on a TV in Developer Mode.
- **[Homebrew Channel](https://www.webosbrew.org/)** (rooted TVs): install the `.ipk`
  from its settings.

`dist/webos/app` is the unpacked app if you'd rather package it with `ares-package`.

The launcher shows the app on a `#1c154a` tile (`iconColor`) with a short description, and
the TV shows `splash.png` while the app loads. The build checks that every image named in
`appinfo.json` exists and has the size LG asks for (icon 80×80, large icon 130×130, splash
1920×1080).

**Audio Guidance.** `appinfo.json` turns on `supportsAudioGuidance`, so the TV's
Audio Guidance (Settings › Accessibility) reads the focused button, card or tab from its
ARIA label. React Native Web turns `accessibilityLabel` and `accessibilityRole` into those,
so give every new focusable an `accessibilityLabel`, especially icon-only ones. Text drawn
with an icon font would otherwise be read as part of the name. The labels have been checked
in desktop Chromium, not yet with the TV's speech.

## Playback

The built-in player is the TV's HTML5 video engine, not libmpv.

- **Containers and codecs:** whatever the TV's media pipeline decodes. That is usually
  MKV and MP4 with H.264/HEVC video and AAC/AC-3/E-AC-3 audio. 10-bit H.264 and some
  lossless audio formats may not play. HLS (online streams) plays natively.
- **Audio tracks** can be switched when the TV exposes them, which webOS does.
- **Subtitles** are drawn by the app: SRT, WebVTT and ASS dialogue lines. ASS styling and
  positioned typesetting (signs) are not rendered.
  - For library files, embedded tracks are extracted by the server. This needs its
    media streaming module and FFmpeg on the server.
  - Embedded subtitles in torrent and debrid streams are not available.
- **Not available:** downloads and offline mode (as on the other TV builds), external
  players, picture-in-picture, audio delay.
- **Online streams** that require a `Referer` header can't send it from a browser.

## Remote control

The arrow keys, OK and Back work as on Android TV. LG remotes also have these keys:

| Key | In the player | Elsewhere |
| --- | --- | --- |
| Red | Audio & subtitles (press again to close) | |
| Green | Episodes | |
| Yellow | Skip the intro or outro when the button is offered, otherwise show the controls | |
| Blue | Settings | |
| Info | Show or hide playback stats | |
| Stop | Ask to leave the player | |
| CH+ / CH- | Next / previous episode (asks first when much of the episode is left) | Page up / down through a list or grid |
| 0 to 9 | Jump to 0 %, 10 % … 90 % of the episode | Type into a text field |
| Play, Pause, ⏩, ⏪ | Play, pause, seek | |

Android TV remotes that have these keys get the same player shortcuts.

**Magic Remote pointer.** Moving the pointer or clicking the video shows the player
controls, and clicking the timeline seeks to that spot. Focus follows the pointer. When
the pointer hides or a system overlay takes it, the D-pad highlight comes back.

**Wheel.** With the pointer showing, the wheel scrolls the page; over a row that only
scrolls sideways it scrolls the row, and the page again once the row reaches its end.
Without the pointer (after an arrow key), each notch moves focus one step up or down
through the list, as LG asks apps to keep the wheel working in 5-way mode. In the player
it does nothing.

**Leaving the app.** Back on the first screen calls `platformBack()`, which shows the
system's exit popup on webOS 6 and later. Keys held while the app goes to the background
are released, so a long seek doesn't continue when you come back.

### Not yet verified on a TV

- **CH+/CH-.** LG's Magic Remote key table marks *Channel +/-* as not available to apps,
  so some TVs may keep these keys for themselves. They are mapped to keyCodes 33/34
  (PageUp/PageDown) in case a TV delivers them; the player's buttons and panels cover the
  same actions.
- **OK in pointer mode.** If a TV sends both a keydown 13 and a click for one OK press, a
  button would fire twice. This needs checking on a TV before adding any de-duplication.
- How far one wheel notch scrolls (`deltaY` per notch) on a real Magic Remote.

## Developing

```bash
npm run dev:webos
```

Open http://localhost:8083 in Chrome at 1920×1080. Arrow keys, Enter and Escape (Back)
act as the remote. The `SEANIME_WEBOS=1` environment variable switches Metro to the
webOS setup (see `metro.config.js`):

- `src/lib/webos/` holds the react-native-tvos APIs for the web:
  - `TVFocusGuideView`, `useTVEventHandler`, `hasTVPreferredFocus` and `requestTVFocus()`
  - the D-pad focus engine (`spatial-navigation.ts`)
  - remote keys, the Magic Remote pointer and wheel, and Back handling (`remote.ts`,
    with the key map in `remote-input.ts`)
- `modules/expo-mpv-player/src/*.web.ts(x)` is the HTML5 `<video>` stand-in for the
  libmpv view.
- `webos/build.mjs` builds the app. It makes every URL relative so the app works from
  `file://`, and lowers JS/CSS to Chromium 79. It also adds polyfills and writes the
  `.ipk`.
