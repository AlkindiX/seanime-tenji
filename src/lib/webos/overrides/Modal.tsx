import * as React from "react"
import type { ModalProps } from "react-native"
import BaseModal from "react-native-web/dist/exports/Modal"
import "../install"
import { pushModal } from "../remote"

/** Modal whose `onRequestClose` runs on the remote's Back key, like Android's dialogs. */
function Modal(props: ModalProps) {
    const { visible = true, onRequestClose } = props
    const closeRef = React.useRef(onRequestClose)
    closeRef.current = onRequestClose

    React.useEffect(() => {
        if (!visible) return
        return pushModal(() => closeRef.current?.({} as never))
    }, [visible])

    return <BaseModal {...props} />
}

export default Modal
