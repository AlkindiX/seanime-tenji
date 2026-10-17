# Seanime Tenji for LG webOS

LG TVs can't run Android apps, so the webOS build is the TV interface rendered with
React Native Web and packaged as a webOS web app (`.ipk`). It uses the same screens as
Android TV and tvOS. The remote works the same way, with D-pad focus, Back, OK and the
media keys; the Magic Remote pointer also works.

**Status: experimental.** It has been exercised in desktop Chromium, not yet on a TV.

## Requirements

- **webOS 6.0 (2021 models) or newer.** webOS 22 or newer is recommended. webOS 6
  (Chromium 79) lacks CSS flexbox `gap` (Chromium 84), which the app uses for most of
  its spacing, so on webOS 6 many screens are visibly cramped: icons touch their labels,
  stacked text and fields have no space between them, and cards and the hero's buttons
  sit against each other. Everything still works; it just looks unfinished there.
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
  MKV and MP4 with H.264 (8-bit, up to High profile), HEVC Main/Main10, VP9 and AV1
  video, and AAC/AC-3/E-AC-3 audio. HLS (online streams) plays natively.
- **Direct play or transcoding (library files).** Before playing a library file, Tenji asks
  the server for its codecs and checks them against what the TV decodes:
  - It plays the file as it is (*direct play*) unless it knows the TV can't. Files it
    sends to the server's transcoder instead: **10-bit H.264 (Hi10P)**, common in anime
    BD encodes, and H.264 4:2:2/4:4:4, which LG's decoders don't support; 12-bit or 4:2:2
    HEVC; Dolby Vision on a TV without it; 4K on a Full HD TV; and an unusual codec the
    browser says it can't decode. A toast says why ("Transcoding: this TV can't play
    10-bit H.264 (Hi10P)").
  - If a direct-played file still fails to decode, Tenji switches to transcoding once and
    carries on from the same position.
  - Transcoding needs FFmpeg on the server and *transcoding enabled* in its media
    streaming settings (and *direct play only* off). Without it, Tenji plays the file
    directly anyway, warns that it may not play, and, if it fails, says what the TV could
    not decode and how to turn transcoding on.
  - The transcode is H.264 + AAC over HLS, played through hls.js so that every playlist
    and segment request carries the server password (the TV's own HLS player can't add
    it). Leaving the player stops the server's transcode. On a TV known not to be 4K, the
    transcode's renditions taller than 1080p are left out, so it never switches to one.
  - Audio the browser says it can't play (e.g. DTS, TrueHD, sometimes Opus or FLAC) only
    gives a warning: the TV's file player often plays what its MSE check refuses.
  - Torrent, debrid and online streams play as they are; the server can't transcode
    them. When the TV can't decode one, the error says so. When the server answers with
    an HTTP error instead (an expired link, a missing file), the error gives the status.
- **Playback stats** (Info key) show the mode (`html5 · direct play`, or
  `html5+hls.js · transcode`), the file's codecs, why it is transcoded, and the TV model.
- **Chapters** of library files come from the server, so the seek bar shows them (and the
  chapter name while seeking) as on Android TV.
- **Background.** Pressing Home or switching inputs pauses playback where it is. If the TV
  released the video decoder meanwhile, the episode is loaded again at that position when
  the app comes back, with the same audio and subtitle tracks (including one added from a
  subtitle search) and speed. It comes back paused with the controls up, also when the
  episode was still loading as the app was hidden; resuming on its own is deliberately
  not done.
- **Resuming** ("continue watching") hands the start position to the TV's media pipeline
  with LG's `mediaOption` parameter, so it doesn't buffer from the start of the file first.
  If the TV rejects it, or the file hasn't loaded after 8 seconds, Tenji loads the file the
  usual way and seeks; if the file then plays, `mediaOption` is skipped for the rest of the
  session (a file the TV can't play at all doesn't count against it). *Not verified on
  a TV*: desktop Chromium plays the `<source>` but ignores the option, so the checks covered
  passing the position, the seek that follows and the fallback, not the speed-up.
- **Audio tracks** can be switched when the TV exposes them, which webOS does.
- **Subtitles** are drawn by the app: SRT, WebVTT and ASS dialogue lines. ASS styling and
  positioned typesetting (signs) are not rendered.
  - For library files, embedded tracks are extracted by the server. This needs its
    media streaming module and FFmpeg on the server.
  - Embedded subtitles in torrent and debrid streams are not available.
- **Not available:** downloads and offline mode (as on the other TV builds), external
  players, picture-in-picture, audio delay.
- **Online streams** that require a `Referer` header can't send it from a browser.

## About this TV

On webOS, Settings shows the model, webOS version (the platform version the TV reports,
e.g. 6.3.0), panel resolution, HDR10 and Dolby Vision support, and which notable video
formats the browser says it decodes, which helps with bug reports. The same facts feed the playback
decision above (4K files on a Full HD panel, Dolby Vision). They come from
`webOSSystem.deviceInfo`/`PalmSystem.deviceInfo` and two Luna calls through
`PalmServiceBridge` (no webOSTV.js): `com.webos.service.tv.systemproperty/getSystemInfo`
(model, firmware, UHD) and `com.webos.service.config/getConfigs` (HDR10, Dolby Vision, panel
resolution). `appinfo.json` declares their access control group (ACG), `systemconfig.query`,
which webOS TV 26 enforces when `requiredACG` is present and webOS TV 27 requires. LG's ACG
guide lists it for `getSystemInfo` and for webOSTV.js's `deviceInfo()` (which reads the same
configs); `getConfigs` has no row of its own, so this is an assumption to check. A refused
or unanswered call (3 seconds) just leaves that fact unknown, and unknown never triggers
transcoding.

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
- Playback of the transcoded HLS stream, and whether `canPlayType`/`MediaSource` answers
  on a TV match what its file player really decodes. Desktop Chromium was used for the
  checks: the open-source build has no H.264, so the transcode's requests (all
  authenticated) were checked but not its picture.
- The real answers of the Luna calls on each webOS version, and ACG enforcement on webOS 26.
- Whether `mediaOption` resumes faster on a TV (see Resuming).

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
- `src/lib/player/web-playback-plan.web.ts` decides how a source is played (direct or
  transcoded, extracted subtitles, chapters, start position), with the rules in
  `src/lib/webos/playback-capabilities.ts` and the TV's facts from `device-info.ts` and
  `luna.ts`.
- `webos/build.mjs` builds the app. It makes every URL relative so the app works from
  `file://`, and lowers JS/CSS to Chromium 79: Tailwind's cascade layers, `@property`,
  `translate`/`scale`/`rotate` and logical shorthands such as `padding-inline` are
  rewritten. Flexbox `gap` and `aspect-ratio` can't be, so webOS 6 ignores them.
  CSS that react-native-web makes at runtime never passes through the build;
  `src/lib/webos/ordered-css-stylesheet.ts` rewrites what old engines drop there
  (`overflow: clip`). It also adds polyfills and writes the `.ipk`.
