import { TVDrawer } from "@/components/tv/tv-drawer"
import { TVButton } from "@/components/tv/tv-focus"
import { tvSize } from "@/components/tv/tv-scale"
import { TVLabeledInput } from "@/components/tv/tv-server-setup"
import { DEFAULT_RECEIVER_PORT, normalizeReceiverUrl } from "@/lib/debug-log-receiver"
import { toast } from "@/lib/utils/toast"
import * as React from "react"
import { Text, TVFocusGuideView, View } from "react-native"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentUrl: string | null
    onSave: (url: string | null) => void
}

export function TVDebugLogReceiverDrawer({ open, onOpenChange, currentUrl, onSave }: Props) {
    const [value, setValue] = React.useState(currentUrl ?? "")

    React.useEffect(() => {
        if (open) setValue(currentUrl ?? "")
    }, [currentUrl, open])

    const save = React.useCallback(() => {
        const url = normalizeReceiverUrl(value)
        if (!url) {
            toast.error("Enter your computer's address, like 192.168.1.20")
            return
        }
        onOpenChange(false)
        onSave(url)
    }, [onOpenChange, onSave, value])

    return (
        <TVDrawer
            open={open}
            onOpenChange={onOpenChange}
            title="Log receiver"
            subtitle="Diagnostics"
            width={tvSize(700)}
        >
            <View style={{ paddingHorizontal: tvSize(30), paddingTop: tvSize(16), gap: tvSize(24) }}>
                <Text className="text-white/60" style={{ fontSize: tvSize(19), lineHeight: tvSize(27) }}>
                    On a computer on the same network, run{" "}
                    <Text className="font-semibold text-white">npm run debug:logs</Text>
                    {" "}in the Seanime Tenji folder. It prints the address to enter here.
                    While a receiver is set, every log line is sent to it as it happens.
                </Text>
                <TVLabeledInput
                    label="Computer address"
                    value={value}
                    placeholder={`192.168.1.20:${DEFAULT_RECEIVER_PORT}`}
                    keyboardType="url"
                    preferred
                    onChangeText={setValue}
                    onSubmitEditing={save}
                />
                <TVFocusGuideView
                    trapFocusLeft
                    trapFocusRight
                    style={{ flexDirection: "row", gap: tvSize(12) }}
                >
                    <TVButton label="Save" variant="primary" onPress={save} />
                    {currentUrl ? (
                        <TVButton
                            label="Stop sending"
                            variant="danger"
                            onPress={() => {
                                onOpenChange(false)
                                onSave(null)
                            }}
                        />
                    ) : null}
                </TVFocusGuideView>
            </View>
        </TVDrawer>
    )
}
