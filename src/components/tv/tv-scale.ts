import { Dimensions, Platform, type ViewStyle } from "react-native"

const BASE_WIDTH = 1920
const BASE_HEIGHT = 1080

const { width, height } = Dimensions.get("window")
const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT)

export function tvSize(size: number) {
    return Math.round(size * scale)
}

export const TV = {
    navHeight: tvSize(64),
    navTop: tvSize(22),
    navInset: tvSize(108),
    gutter: tvSize(64),
    sectionGap: tvSize(38),
    cardGap: tvSize(22),
    radius: tvSize(18),
    focusBorder: Math.max(2, tvSize(4)),
}

/**
 * Style for a horizontal list whose focused cards may grow past its edges.
 * Native TV lists don't clip then. On the web an inline `overflow: "visible"`
 * replaces react-native-web's `overflowX: auto`, and the row stops scrolling
 * (the D-pad and the Magic Remote then can't bring hidden cards in), so it is
 * left out there; the rows pad their content instead.
 */
export const ROW_OVERFLOW: ViewStyle | null = Platform.OS === "web" ? null : { overflow: "visible" }

/**
 * `getItemLayout` for a horizontal row of equal-width cards (padded by the
 * gutter, `TV.cardGap` apart). With it, a FlatList knows where every card is
 * and stops measuring each one as it mounts; on webOS each measurement
 * forces a layout, and a screen of rows paid for it on every visit.
 */
export function rowItemLayout(itemWidth: number) {
    const length = itemWidth + TV.cardGap
    return (_data: unknown, index: number) => ({ length, offset: TV.gutter + index * length, index })
}

/** Rows of media cards (TVMediaCard at 220) and of episode cards (TVEpisodeCard, 410). */
export const MEDIA_ROW_LAYOUT = rowItemLayout(tvSize(220))
export const EPISODE_ROW_LAYOUT = rowItemLayout(tvSize(410))
