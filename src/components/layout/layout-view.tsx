import { Styles } from "@/components/shared/styles"
import React from "react"
import { View } from "react-native"
import { SafeAreaView, SafeAreaViewProps } from "react-native-safe-area-context"

export function LayoutContainerView({ children }: { children?: React.ReactNode }) {
    return <View style={Styles.Container}>
        {children}
    </View>
}

export function SafeView({ children, ...rest }: { children?: React.ReactNode } & SafeAreaViewProps) {
    return <SafeAreaView style={Styles.Container} edges={["top", "left", "right"]} {...rest}>
        {children}
    </SafeAreaView>
}
