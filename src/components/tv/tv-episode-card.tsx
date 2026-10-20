import { TVFocusScaleView, usePreferredFocus, useTVFocus } from "@/components/tv/tv-focus"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Ionicons } from "@/lib/icons/Ionicons"
import * as React from "react"
import { Pressable, type PressableProps, Text, View } from "react-native"

export interface TVEpisodeCardProps extends Omit<PressableProps, "onPress"> {
    image?: string
    duration?: number
    badge?: string
    title: string
    subtitle?: string
    onPress: () => void
    preferred?: boolean
    recyclingKey?: string
    progressPercent?: number
    completed?: boolean
    filler?: boolean
    blurred?: boolean
}

export const TVEpisodeCard = React.memo(
    React.forwardRef<React.ElementRef<typeof Pressable>, TVEpisodeCardProps>(
        function TVEpisodeCard({
            image,
            duration,
            badge,
            title,
            subtitle,
            onPress,
            preferred,
            recyclingKey,
            progressPercent,
            completed,
            filler,
            blurred,
            ...props
        }, ref) {
            const focus = useTVFocus(1.05, title)
            const isPreferred = usePreferredFocus(preferred)
            const width = tvSize(410)
            const imageHeight = tvSize(225)

            return (
                <Pressable
                    ref={ref}
                    onPress={onPress}
                    onFocus={focus.focus}
                    onBlur={focus.blur}
                    hasTVPreferredFocus={isPreferred}
                    scrollSnapAlign="start"
                    accessibilityRole="button"
                    accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}`}
                    style={{ width }}
                    {...props}
                >
                    <TVFocusScaleView style={focus.style}>
                        <View
                            style={{
                                width,
                                height: imageHeight,
                                overflow: "hidden",
                                borderRadius: TV.radius,
                                borderWidth: TV.focusBorder,
                                borderColor: focus.focused ? "#fff" : "transparent",
                                backgroundColor: "rgba(255,255,255,0.0)",
                            }}
                        >
                            <Image
                                source={image ? { uri: image } : undefined}
                                style={{ width: "100%", height: "100%" }}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                recyclingKey={recyclingKey}
                                transition={100}
                                blurRadius={blurred ? tvSize(18) : 0}
                            />
                            {completed ? (
                                <View
                                    pointerEvents="none"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        backgroundColor: "rgba(0,0,0,0.6)",
                                    }}
                                />
                            ) : null}
                            <LinearGradient
                                colors={["transparent", "rgba(0,0,0,0.78)"]}
                                locations={[0.42, 1]}
                                style={{ position: "absolute", inset: 0 }}
                                pointerEvents="none"
                            />
                            {completed ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        top: tvSize(12),
                                        left: tvSize(12),
                                        minHeight: tvSize(30),
                                        borderRadius: tvSize(16),
                                        paddingHorizontal: tvSize(10),
                                        backgroundColor: "rgba(20,20,20,0.78)",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: tvSize(5),
                                    }}
                                >
                                    <Ionicons name="checkmark" size={tvSize(15)} color="#ffffff" />
                                    <Text className="font-semibold text-white" style={{ fontSize: tvSize(15) }}>
                                        Completed
                                    </Text>
                                </View>
                            ) : filler ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        top: tvSize(12),
                                        left: tvSize(12),
                                        borderRadius: tvSize(7),
                                        paddingHorizontal: tvSize(9),
                                        paddingVertical: tvSize(5),
                                        backgroundColor: "rgba(234,179,8,0.9)",
                                    }}
                                >
                                    <Text className="font-bold text-black" style={{ fontSize: tvSize(14) }}>
                                        FILLER
                                    </Text>
                                </View>
                            ) : null}
                            <View
                                style={{
                                    position: "absolute",
                                    left: tvSize(14),
                                    right: tvSize(14),
                                    bottom: tvSize(12),
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                }}
                            >
                                <Text className="font-semibold text-white" style={{ fontSize: tvSize(20) }}>
                                    {badge}
                                </Text>
                                {duration ? (
                                    <Text className="text-white/80" style={{ fontSize: tvSize(17) }}>
                                        {duration}m
                                    </Text>
                                ) : null}
                            </View>
                            {progressPercent !== undefined && progressPercent > 0 && !completed ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        height: tvSize(5),
                                        backgroundColor: "rgba(255,255,255,0.12)",
                                    }}
                                >
                                    <View
                                        style={{
                                            width: `${Math.min(progressPercent, 100)}%`,
                                            height: "100%",
                                            backgroundColor: "#8176ef",
                                        }}
                                    />
                                </View>
                            ) : null}
                        </View>
                        <Text
                            className="font-semibold text-white"
                            numberOfLines={1}
                            style={{
                                marginTop: tvSize(10),
                                fontSize: tvSize(22),
                                opacity: focus.focused ? 1 : 0.82,
                            }}
                        >
                            {title}
                        </Text>
                        {subtitle ? (
                            <Text
                                className="text-white/45"
                                numberOfLines={1}
                                style={{ marginTop: tvSize(2), fontSize: tvSize(18) }}
                            >
                                {subtitle}
                            </Text>
                        ) : null}
                    </TVFocusScaleView>
                </Pressable>
            )
        })
)
