// react-native-web ships no types; its exports mirror react-native's.
declare module "react-native-web" {
    export * from "react-native"
}

declare module "react-native-web/dist/exports/*" {
    const value: any
    export default value
}

declare module "uniwind/components/createOrderedCSSStyleSheet" {
    const createOrderedCSSStyleSheet: (sheet: CSSStyleSheet | null) => {
        getTextContent: () => string
        insert: (cssText: string, groupValue: number) => void
    }
    export default createOrderedCSSStyleSheet
}
