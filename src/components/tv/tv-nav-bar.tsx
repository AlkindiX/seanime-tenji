import { useTVFocus } from "@/components/tv/tv-focus"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { IMAGES } from "@/constants/images"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import { router, useSegments } from "expo-router"
import * as React from "react"
import { ActivityIndicator, Animated, Pressable, Text, TVFocusGuideView, View } from "react-native"

const ITEMS = [
    {
        key: "anime",
        label: "Anime",
        icon: "tv-outline" as const,
        activeIcon: "tv" as const,
        href: "/(app)/(tabs)/(library)" as const,
    },
    {
        key: "discover",
        label: "Discover",
        icon: "compass-outline" as const,
        activeIcon: "compass" as const,
        href: "/(app)/(tabs)/discover" as const,
    },
    {
        key: "lists",
        label: "My Lists",
        icon: "albums-outline" as const,
        activeIcon: "albums" as const,
        href: "/(app)/(tabs)/my-lists" as const,
    },
    {
        key: "settings",
        label: "Settings",
        icon: "settings-outline" as const,
        activeIcon: "settings" as const,
        href: "/(app)/(tabs)/(profile)" as const,
    },
]

function NavItem({
    item,
    active,
    pending,
    onPress,
}: {
    item: (typeof ITEMS)[number]
    active: boolean
    pending: boolean
    onPress: () => void
}) {
    const focusState = useTVFocus(1.05, item.label)
    const selected = active || pending

    return (
        <Pressable
            onPress={onPress}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            style={{ flexShrink: 0 }}
        >
            {({ focused }) => (
                <Animated.View
                    style={[
                        focusState.style,
                        {
                            minHeight: tvSize(40),
                            paddingHorizontal: tvSize(22),
                            paddingVertical: tvSize(5),
                            borderRadius: tvSize(99),
                            borderWidth: tvSize(2),
                            borderColor: focused ? "#ffffff" : "transparent",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: tvSize(10),
                            backgroundColor: focused
                                ? "#ffffff"
                                : (selected ? "rgba(255,255,255,0.12)" : "transparent"),
                        },
                    ]}
                >
                    {pending ? (
                        <ActivityIndicator
                            size={tvSize(26)}
                            color={focused ? "#0a0a0a" : "#ffffff"}
                        />
                    ) : (
                        <Ionicons
                            name={focused || active ? item.activeIcon : item.icon}
                            size={tvSize(26)}
                            color={focused
                                ? "#0a0a0a"
                                : (active ? "#ffffff" : "rgba(255,255,255,0.46)")}
                        />
                    )}
                    <Text
                        className="font-semibold"
                        style={{
                            color: focused
                                ? "#0a0a0a"
                                : (selected ? "#ffffff" : "rgba(255,255,255,0.5)"),
                            fontSize: tvSize(20),
                        }}
                    >
                        {item.label}
                    </Text>
                </Animated.View>
            )}
        </Pressable>
    )
}

export function TVNavBar() {
    const segments = useSegments()
    const routeKey = segments.join("/")
    const [pending, setPending] = React.useState<string | null>(null)
    const isActive = React.useCallback((key: (typeof ITEMS)[number]["key"]) => {
        if (key === "discover") return routeKey.includes("discover")
        if (key === "lists") return routeKey.includes("my-lists")
        if (key === "settings") return routeKey.includes("(profile)") && !routeKey.includes("my-lists")
        return routeKey.includes("(library)")
            || (!routeKey.includes("discover")
                && !routeKey.includes("my-lists")
                && !routeKey.includes("(profile)"))
    }, [routeKey])

    React.useEffect(() => {
        setPending(null)
    }, [routeKey])

    const open = React.useCallback((item: (typeof ITEMS)[number]) => {
        if (isActive(item.key)) return

        setPending(item.key)
        router.navigate(item.href as never)
    }, [isActive])

    return (
        <View
            pointerEvents="box-none"
            style={{
                position: "absolute",
                top: TV.navTop,
                left: TV.gutter,
                right: TV.gutter,
                zIndex: 200,
                flexDirection: "row",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <View
                style={{
                    // minHeight: TV.navHeight,
                    paddingVertical: tvSize(6),
                    paddingHorizontal: tvSize(8),
                    borderRadius: tvSize(99),
                    // borderWidth: tvSize(1),
                    // borderColor: "rgba(255,255,255,0.1)",
                    backgroundColor: "rgba(10,10,12,0.92)",
                    flexDirection: "row",
                    alignItems: "center",
                    // shadowColor: "#000000",
                    // shadowOpacity: 0.38,
                    // shadowRadius: tvSize(16),
                    // shadowOffset: { width: 0, height: tvSize(7) },
                    // elevation: 16,
                }}
            >
                <View
                    style={{
                        width: tvSize(30),
                        height: tvSize(30),
                        marginLeft: tvSize(5),
                        marginRight: tvSize(14),
                        borderRadius: tvSize(0),
                        overflow: "hidden",
                    }}
                >
                    <Image
                        source={IMAGES.logo2}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                        accessibilityLabel="Seanime"
                    />
                </View>
                {/*<View
                    style={{
                        width: tvSize(1),
                        height: tvSize(28),
                        marginRight: tvSize(7),
                        backgroundColor: "rgba(255,255,255,0.1)",
                    }}
                />*/}
                <TVFocusGuideView
                    // trapFocusLeft
                    trapFocusRight
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(4),
                    }}
                >
                    {ITEMS.map(item => (
                        <NavItem
                            key={item.label}
                            item={item}
                            active={isActive(item.key)}
                            pending={pending === item.key}
                            onPress={() => open(item)}
                        />
                    ))}
                </TVFocusGuideView>
            </View>
        </View>
    )
}
