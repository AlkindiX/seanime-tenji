import "../install"
import { addBackListener } from "../remote"
import { exitApp } from "../webos-platform"

type Subscription = { remove: () => void }

const subscriptions = new Map<() => boolean | null | undefined, Subscription>()

/** `hardwareBackPress` fed by the remote's Back key. */
const BackHandler = {
    addEventListener(_eventName: "hardwareBackPress", handler: () => boolean | null | undefined): Subscription {
        const remove = addBackListener(handler)
        const subscription = {
            remove: () => {
                remove()
                subscriptions.delete(handler)
            },
        }
        subscriptions.set(handler, subscription)
        return subscription
    },
    removeEventListener(_eventName: "hardwareBackPress", handler: () => boolean | null | undefined) {
        subscriptions.get(handler)?.remove()
    },
    exitApp,
}

export default BackHandler
