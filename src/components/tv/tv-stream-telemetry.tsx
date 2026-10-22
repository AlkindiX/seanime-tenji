import { tvSize } from "@/components/tv/tv-scale"
import { torrentStreamStatusAtom } from "@/lib/player/session"
import { describeTorrentStatus } from "@/lib/player/stream-telemetry"
import { useAtomValue } from "jotai/react"
import ArrowDown from "lucide-react-native/icons/arrow-down"
import Users from "lucide-react-native/icons/users"
import * as React from "react"
import { Text, View } from "react-native"

const TEXT = "rgba(255,255,255,0.92)"
const MUTED = "rgba(255,255,255,0.6)"

// Spacing is margins, not gap: webOS 6 (Chromium 79) has no flexbox gap.
function Separator() {
    return (
        <View
            style={{
                width: tvSize(5),
                height: tvSize(5),
                marginHorizontal: tvSize(12),
                borderRadius: tvSize(3),
                backgroundColor: "rgba(255,255,255,0.35)",
            }}
        />
    )
}

/**
 * The torrent stream's download stats in a pill, shown with the player's
 * controls: speed, how much of the file is in, seeders and how far ahead of
 * playback the video is buffered. The server sends the stats every few
 * seconds; only this pill reads them, so nothing else re-renders.
 */
export function TVStreamTelemetry({ bufferedSeconds }: { bufferedSeconds: number }) {
    const status = useAtomValue(torrentStreamStatusAtom)
    if (!status) return null

    const stats = describeTorrentStatus(status, bufferedSeconds)
    const textStyle = { color: TEXT, fontSize: tvSize(18), fontVariant: ["tabular-nums" as const] }

    return (
        <View
            accessible
            accessibilityLabel={stats.label}
            pointerEvents="none"
            style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                paddingHorizontal: tvSize(18),
                paddingVertical: tvSize(10),
                borderRadius: tvSize(26),
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.14)",
                backgroundColor: "rgba(0,0,0,0.55)",
            }}
        >
            <View style={{ marginRight: tvSize(6) }}>
                <ArrowDown size={tvSize(18)} color={TEXT} />
            </View>
            <Text className="font-semibold" style={textStyle}>{stats.speed}</Text>
            <Separator />
            <Text className="font-semibold" style={textStyle}>{stats.downloaded}</Text>
            <Separator />
            <View style={{ marginRight: tvSize(6) }}>
                <Users size={tvSize(17)} color={MUTED} />
            </View>
            <Text className="font-medium" style={textStyle}>{stats.seeders}</Text>
            {stats.buffered ? (
                <>
                    <Separator />
                    <Text className="font-medium" style={[textStyle, { color: MUTED }]}>
                        {stats.buffered} buffered
                    </Text>
                </>
            ) : null}
        </View>
    )
}
