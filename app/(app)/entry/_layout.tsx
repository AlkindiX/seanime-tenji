import { tvStackScreenLayout } from "@/components/tv/tv-screen-transition"
import { Stack } from "expo-router"
import { Platform } from "react-native"

export default function EntryLayout() {
    return <Stack screenOptions={{ headerShown: false }} screenLayout={Platform.isTV ? tvStackScreenLayout : undefined} />
}
