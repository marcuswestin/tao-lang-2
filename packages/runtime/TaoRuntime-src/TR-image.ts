export type TaoImageSource = {
  uri: string
}

export type TaoImageResizeMode = 'center' | 'contain' | 'cover' | 'repeat' | 'stretch'

/** Image exposes React Native image source helpers for generated Tao apps. */
export const Image = {
  /** remote creates a React Native remote image source. */
  remote(uri: string): TaoImageSource {
    return { uri }
  },

  /** resizeMode normalizes supported React Native image resize modes. */
  resizeMode(mode: string | undefined): TaoImageResizeMode {
    return mode === 'center' || mode === 'contain' || mode === 'cover' || mode === 'repeat' || mode === 'stretch'
      ? mode
      : 'cover'
  },
} as const
