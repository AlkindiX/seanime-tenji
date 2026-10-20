/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Inspired by and/or derived from Streamyfin (https://github.com/streamyfin/streamyfin)
 * and Findroid (https://github.com/findroid/findroid).
 * Copyright (c) the original authors and Seanime Tenji contributors.
 */

export { MpvPlayerView } from "./MpvPlayerView"
export { MpvPlayerModule } from "./MpvPlayerModule"
export { registerSubtitleFeed, getSubtitleFeed } from "./subtitle-feed"
export type { SubtitleFeed, SubtitleFeedAssChunk, SubtitleFeedCue, SubtitleFeedTrack, SubtitleFeedPlayerEvent } from "./subtitle-feed"
export { assDialogueCue, parseAssTopStyles } from "./web/subtitles"
export type { AssTopStyles, SubtitleImage } from "./web/subtitles"

export type {
    MpvVideoSource,
    MpvExternalSubtitle,
    MpvMediaInfoSummary,
    MpvChapter,
    NowPlayingMetadata,
    MpvVideoOutput,
    SubtitleHorizontalAlignment,
    SubtitleVerticalAlignment,
    MpvPlayerViewRef,
    MpvPlayerViewProps,
    OnLoadEventPayload,
    OnProgressEventPayload,
    OnPlaybackStateChangePayload,
    OnErrorEventPayload,
    OnPictureInPictureChangeEventPayload,
    SubtitleTrack,
    AudioTrack,
    TechnicalInfo,
} from "./MpvPlayer.types"
