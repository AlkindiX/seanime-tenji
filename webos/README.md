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
- **A server password is optional.** A packaged webOS app runs from `file://`, and a
  Seanime server without a password refuses the app's own WebSocket (`Origin: null`). The
  IPK therefore brings a small JS service that opens that connection for the app; see
  [Live connection](#live-connection). If the service is missing from an install, the app
  says so and asks for a password instead. With a password set, Tenji authenticates every
  request. Set one in the server settings or in `config.toml`:

  ```toml
  [server]
  password = "your password"
  ```

  Restart the server afterwards. If a server without a password still turns the app's
  requests away (`403 this action requires either a server password or a trusted local
  origin`), the app says so instead of staying on "Connecting".
- **The server reachable from the TV.** It has to listen on the network (`host = '0.0.0.0'`,
  not `127.0.0.1`), and the computer's firewall has to let its port (43211 by default)
  in. On Windows, a network set to *Public* blocks it unless Seanime has an inbound rule.

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

`dist/webos/app` is the unpacked app and `dist/webos/service` its JS service, if you'd rather
package them with `ares-package dist/webos/app dist/webos/service`. Every way of installing
above installs the service with the app.

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
    them. When the TV can't decode one, the error says so and names the file's codecs.
    When the server answers with an HTTP error instead (an expired link, a missing file),
    the error gives the status.
  - A file that hasn't started after 45 seconds counts as one the TV can't play. LG's
    player can wait forever without an error, notably on audio it doesn't play inside a
    video file: FLAC, Vorbis, TrueHD, and DTS on many models. Tenji warns when a torrent or
    debrid stream has such audio; pick a release with AAC or AC-3 audio instead.
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
- **Leaving the player.** Back leaves at once, without asking: playback pauses, the player
  fades out (160 ms, opacity and scale with the Web Animations API) and the page underneath
  eases in. Back still closes an open panel or dialog first, then the controls. Stop and the
  controls' exit button leave the same way. The position goes to the server's watch history
  before the player closes.
- **Torrent and debrid streams keep running** after you leave the player, in case Back was
  pressed by accident. The server goes on downloading the episode's file (it marks the whole
  file for download) and Tenji keeps the subtitle lines it sends meanwhile. Playing that
  episode again (its card, *Play*, or *Resume* on the card the Torrents tab shows, which has
  focus when you come back from the player) reopens the player at once where you left it,
  without asking the server for a new stream, so nothing is downloaded again. First a HEAD
  request checks that the server still serves that stream; if it doesn't (it restarted,
  another device started a stream, the torrent was stopped elsewhere), the episode starts
  afresh as usual.
  - The kept stream ends when another episode or video starts (torrent, debrid, library file
    or online stream), with *Stop* on that card, when the episode played to the end or the
    player failed, after 30 minutes nobody watched it, and when the app closes (sent as the
    page unloads, so not guaranteed). Stopping the stream on the server ends it too.
  - Picking it up again tells the server the player is back (`video-loaded`) and reports a
    seek to where it starts: the server sends each subtitle line only once and ignores a
    second `video-loaded-metadata` after a seek, so the seek makes it read the subtitles again
    from there.
- **Resuming** ("continue watching") hands the start position to the TV's media pipeline
  with LG's `mediaOption` parameter, so it doesn't buffer from the start of the file first.
  If the TV rejects it, or the file hasn't loaded after 8 seconds, Tenji loads the file the
  usual way and seeks; if the file then plays, `mediaOption` is skipped for the rest of the
  session (a file the TV can't play at all doesn't count against it). *Not verified on
  a TV*: desktop Chromium plays the `<source>` but ignores the option, so the checks covered
  passing the position, the seek that follows and the fallback, not the speed-up.
- **Audio tracks** can be switched when the TV exposes them, which webOS does.
- **Subtitles** are drawn by the app.
  - **ASS/SSA** are drawn by libass, as mpv does on the other builds: fonts (the ones the
    file carries, from the server), styling, signs, positioning and animation. libass runs
    in WebAssembly ([JASSUB](https://github.com/ThaUnknown/jassub)) in a worker, drawing
    on a canvas over the video. *Subtitle styling* under Audio & subtitles switches to
    plain text lines instead (what's left of the dialogue, without signs), which is also
    used when libass can't start on a TV.
  - **SRT and WebVTT** are drawn as text in the subtitle size you pick.
  - **PGS** (image subtitles of Blu-ray rips) in torrent and debrid streams are shown as
    the server decodes them, placed where the disc puts them.
  - For library files, embedded tracks are extracted by the server. This needs its
    media streaming module and FFmpeg on the server. PGS tracks of library files are not
    handled yet.
  - **Torrent and debrid streams** use the server's *direct stream*, the same mode the
    Seanime web player uses: the server serves the file with a type the TV accepts and
    reads its subtitle lines as it goes, sending them over the websocket once the player
    has loaded the file, and again from the new position after a seek. All embedded
    tracks are listed from the start; their lines fill in as the episode plays.
  - A subtitle track is turned on by the preferred languages (`eng, en, english` by
    default), or else the first track that isn't signs & songs. Choosing *Off* in the
    player keeps subtitles off for later episodes until a track is chosen again.
- **Not available:** downloads and offline mode (as on the other TV builds), external
  players, picture-in-picture, audio delay.
- **Online streams** go through the Seanime server's proxy (`/api/v1/proxy`, the one the
  Seanime web player uses), video and subtitle files alike. A packaged webOS app can't
  send the `Referer` many hosts require, and most hosts don't answer its CORS requests;
  the proxy adds the source's headers and rewrites HLS playlists so every segment goes
  through it too. HLS plays through hls.js. The proxy follows the server's security mode:
  in strict mode it won't fetch from private-network addresses.

## Live connection

Torrent and debrid streams are started and followed over a WebSocket to the server
(`/events`). A packaged webOS app runs from `file://`, so the browser sends `Origin: null`
with that handshake, and a page can't change the header. A Seanime server without a
password answers it with 403 ("requires either a server password or a trusted local
origin"): the check keeps websites in a browser away from the server. Requests that carry no
Origin at all, like the native apps' and the TV app's HTTP requests, pass.

So the IPK carries a JS service, `app.seanime.tenji.service` (`webos/service/`), that opens
the WebSocket from Node, which sends no Origin, and relays it to the app over the Luna bus:

- The app calls `luna://app.seanime.tenji.service/connect` with the `ws://` or `wss://` URL and
  `subscribe: true` through `PalmServiceBridge`. The subscription answers
  `{event: "connecting", socketId}` right away, then `open`, `message` (text frames), `error`
  and `close` (code, reason) as the socket goes. `send` and `close` take the `socketId`.
- On the app's side, `src/lib/webos/luna-websocket.ts` wraps this in the part of the browser's
  `WebSocket` that `websocket-provider.tsx` uses, so reconnecting, the close codes in Settings
  and `websocketLastCloseAtom` work as before. A refused or failed handshake closes with 1006
  after an `error` naming the cause, e.g. `Unexpected server response: 403`.
- Cancelling the subscription closes the server socket. The app cancels it when it closes a
  socket, and the bus cancels it when the app exits. The service exits 35 seconds after its
  last subscription ends.
- The service is `ws` 7 bundled by esbuild for Node 8.12, the Node of webOS 5 and 6; webOS 22
  and 23 have Node 12, later releases newer. `webos-service` comes with the TV and is not
  bundled. ws 8 needs Node 10, so `package.json` pins ws 7 and the build checks for it.
- `webos/build.mjs` writes it to `usr/palm/services/app.seanime.tenji.service/` in the IPK
  (`service.js`, `package.json`, `services.json` and ws's license), lists it under `services`
  in `packageinfo.json`, and makes that directory 0777, as LG's `ares-package` does. LG
  requires the service ID to start with the app ID followed by a dot.
- **Without the service** (the bus answers "Service does not exist" or refuses the call), the
  app uses the page's own WebSocket for the rest of the session. With no server password
  that is refused, and Settings and the stream error ask for a password, as they did before
  the service existed.

Settings › *Live updates* says "Connected through the app's relay service" when the socket
goes through it. In the debug logs every WebSocket attempt shows `via: "relay"` or
`via: "browser"`, and the relay's errors come through as the socket's `error` events. The
service also writes `[relay]` lines (without the password token) to the TV's system log; with
Developer Mode, `ares-inspect --device tv --service app.seanime.tenji.service --open` opens
its inspector.

## About this TV

On webOS, Settings shows *Live updates*, the state of the websocket to the server, with how
the last connection closed and whether it goes through the relay service. Torrent and debrid
streams are started and followed over it, so without it they can't start; Tenji then says so
instead of waiting.

Settings also shows the model, webOS version (the platform version the TV reports,
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

## Look and feel

- **Transitions.** Switching tabs slides the new one in from the side its nav item is on;
  opening a page slides it in from the right and Back eases the previous one in from the
  left. They are Web Animations on opacity and transform, which the TV composites without
  JavaScript per frame (`src/components/tv/tv-screen-transition.tsx`).
- **Library hero.** The backdrop cross-fades between titles, the text eases in, and the
  current page dot fills up until the next title. It doesn't rotate while one of its
  buttons has focus. Its buttons stay in place whatever the title's length. Watch progress
  is a short meter next to the episode ("19m left") and the button says *Resume*.
- **Under the nav bar.** Lists scrolled up under the floating nav bar fade into the
  background (`tv-nav-scrim.tsx`; Android TV uses `fadingEdgeLength` for this).
- **Speed.** Focus highlights scale with CSS transitions, rows know their card sizes up
  front, and cards re-render only when their own data changes. Measured in desktop Edge
  slowed to about TV speed: arrow keys use a third to a fifth of the CPU they did, and
  going back to the library blocks the screen 15-30 % less.

## Remote control

The arrow keys, OK and Back work as on Android TV. LG remotes also have these keys:

| Key | In the player | Elsewhere |
| --- | --- | --- |
| Red | Audio & subtitles (press again to close) | |
| Green | Episodes | |
| Yellow | Skip the intro or outro when the button is offered, otherwise show the controls | |
| Blue | Settings | |
| Info | Show or hide playback stats | |
| Stop | Leave the player, as Back does (a stream keeps running; see Playback) | |
| CH+ / CH- | Next / previous episode (asks first when much of the episode is left) | Page up / down through a list or grid |
| 0 to 9 | Jump to 0 %, 10 % … 90 % of the episode | Type into a text field |
| Play, Pause, ⏩, ⏪ | Play, pause, seek | |

Android TV remotes that have these keys get the same player shortcuts.

**Magic Remote pointer.** Moving the pointer shows the player controls, clicking the
video pauses or plays, and clicking the timeline seeks to that spot. Focus follows the
pointer. When the pointer hides or a system overlay takes it, the D-pad highlight comes
back.

**Dragging.** Press the wheel (OK) on a row and move the pointer to drag the row sideways,
or on the page to drag it up and down; let go while moving and it glides on a little. A
press that moves less than 12 px is a click, and the click that ends a drag doesn't open
the card under the pointer.

**Pausing with the wheel.** The wheel is the OK button. In the player, pressing it while
the controls are hidden pauses or plays (and shows them); with the pointer showing, so
does clicking the video. When the controls are up, OK presses the focused button as usual.

**Scrolling with the arrows.** Lists and the page glide to the focused card. Holding an
arrow key or tapping it quickly extends that one movement rather than starting a new
animation for every step.

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
  Pausing from the wheel already counts only one of the two (within 400 ms).
- Pausing with the wheel, and how dragging feels with a real Magic Remote. Dragging was
  checked in desktop Chromium with a mouse.
- How far one wheel notch scrolls (`deltaY` per notch) on a real Magic Remote.
- Playback of the transcoded HLS stream, and whether `canPlayType`/`MediaSource` answers
  on a TV match what its file player really decodes. Desktop Chromium was used for the
  checks: the open-source build has no H.264, so the transcode's requests (all
  authenticated) were checked but not its picture.
- The real answers of the Luna calls on each webOS version, and ACG enforcement on webOS 26.
- Whether `mediaOption` resumes faster on a TV (see Resuming).
- libass on a TV: its speed with heavy typesetting, and loading its worker and wasm from
  `file://` (they are read with XMLHttpRequest and handed over as blob URLs, as a worker
  can't `fetch()` files). Checked in desktop Chromium over http. If it fails, subtitles
  fall back to plain text. JASSUB's worker needs Chromium 80 for `type: "module"`; the
  build makes it a classic script, so webOS 6 may run it too.
- PGS placement was checked with a test image, not a real Blu-ray track.
- Leaving the player and resuming a kept stream: checked by typecheck, unit tests of the
  bookkeeping and the Seanime 3.10.4 server source, not yet against a server or on a TV.
  Still to see on a TV: whether the exit fade also fades the video (webOS may draw video on
  its own plane, in which case the paused frame stays until the player closes), how long
  resuming takes, and whether the stream ends when the app is closed.
- The relay service on a TV (see Live connection). The relay was tested against a local `ws`
  server, the app's side through a stand-in `PalmServiceBridge`, and the built bundle with a
  stand-in `webos-service`, all in Node 22. Still to check on a TV: that Developer Mode and
  Homebrew Channel installs start the service; that the bundle runs on Node 8.12 (webOS 6)
  and Node 12 (webOS 22/23); that `PalmServiceBridge` delivers every subscription answer and
  passes on `cancel()`; that a passwordless Seanime accepts the relay's handshake from
  another machine; and that large server messages pass over the bus. LG documents no size
  limit for Luna messages. LG's ACG guide doesn't say whether webOS 26 checks an app's
  calls to its own service; a refused call counts as a missing service.

## Debug logs

A TV has no clipboard or share sheet, so Settings › **Diagnostics** keeps logs on the TV
and can stream them to a computer on the same network:

1. On the computer, in this repository, run:
   ```bash
   npm run debug:logs
   ```
   It prints the addresses to use (port 8787) and writes everything it receives to
   `debug-logs/tenji-<date>.log`. Let Node through the firewall if Windows asks.
2. On the TV, open Settings › Diagnostics and turn on **Debug Logging**.
3. Open **Log Receiver** and enter the computer's address, e.g. `192.168.1.20` (the port
   defaults to 8787). The TV sends a test request and shows whether it got through.
4. Reproduce the problem. Lines appear in the terminal as they happen. **Send Saved Logs**
   sends everything saved on the TV so far, including what was logged before a receiver
   was set; the receiver skips lines it already has.

The TV keeps the last 1,500 entries while logging is on, across restarts. Tokens and
passwords are replaced with `[redacted]` before logs leave the TV. **Test Connection** asks
the server for `/api/v1/status` and logs the result. The text under it shows what the app
thinks of the server (`reachable`, `unknown`, which shows as "Checking server", or
`unreachable`), the network, the WebSocket, and what last changed that state.

The connection is logged at each step: NetInfo, every change to the server state and what
caused it, every WebSocket attempt with its close code and how long it stayed open, every
request's status and time, and the app being suspended, resumed or relaunched. The same
switch exists on phones under Profile › Logs.

With Developer Mode, `ares-inspect --device tv --app app.seanime.tenji --open` also opens
Chrome DevTools on the running app.

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
  (`overflow: clip`). It also adds polyfills, bundles the JS service
  (`webos/service-build.mjs`) and writes the `.ipk`.
- `webos/service/` is the JS service that relays the WebSocket (`relay.ts`, entry point
  `service.ts`), and `src/lib/webos/luna-websocket.ts` is its counterpart in the app. A
  desktop browser has no Luna bus, so `npm run dev:webos` uses the browser's WebSocket.
  `tests/webos-websocket-relay.test.ts` covers both sides.
