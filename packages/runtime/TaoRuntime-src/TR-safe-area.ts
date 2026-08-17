export type TaoSafeAreaInsets = {
  bottom: number
  left: number
  right: number
  top: number
}

export type TaoSafeAreaPadding = {
  paddingBottom: number
  paddingLeft: number
  paddingRight: number
  paddingTop: number
}

type SafeAreaContextModule = {
  useSafeAreaInsets(): TaoSafeAreaInsets
}

/** SafeArea exposes provider-backed native safe-area helpers. */
export const SafeArea = {
  /** insets reads the current safe-area edge insets from the app shell provider. */
  insets(): TaoSafeAreaInsets {
    return safeAreaContext().useSafeAreaInsets()
  },

  /** edgePadding converts safe-area insets into React Native padding style values. */
  edgePadding(insets: TaoSafeAreaInsets, extra = 0): TaoSafeAreaPadding {
    return {
      paddingBottom: insets.bottom + extra,
      paddingLeft: insets.left + extra,
      paddingRight: insets.right + extra,
      paddingTop: insets.top + extra,
    }
  },
} as const

function safeAreaContext(): SafeAreaContextModule {
  return require('react-native-safe-area-context') as SafeAreaContextModule
}
