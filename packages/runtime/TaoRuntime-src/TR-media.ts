export type TaoPickedImage = {
  fileName?: string
  height: number
  mimeType?: string
  uri: string
  width: number
}

export type TaoImagePickOptions = {
  allowsEditing?: boolean
  quality?: number
}

export type TaoImagePickResult = {
  canceled: boolean
  image?: TaoPickedImage
  permissionGranted: boolean
}

export type TaoMediaDriver = {
  launchImageLibraryAsync(options: Record<string, unknown>): Promise<ExpoImagePickResult>
  requestMediaLibraryPermissionsAsync(writeOnly?: boolean): Promise<{ granted?: boolean; status?: string }>
}

export type TaoMediaAction = {
  invoke(): Promise<void>
}

export type TaoImagePickedAction = {
  invoke(result: TaoImagePickResult): void
}

type ExpoImagePickAsset = {
  fileName?: string | null
  height?: number
  mimeType?: string | null
  uri: string
  width?: number
}

type ExpoImagePickResult = {
  assets?: ExpoImagePickAsset[] | null
  canceled: boolean
}

let testDriver: TaoMediaDriver | undefined

/** Media exposes Expo Image Picker-backed media selection helpers. */
export const Media = {
  /** pickImage requests library access and returns the first selected image. */
  async pickImage(options: TaoImagePickOptions = {}): Promise<TaoImagePickResult> {
    const driver = mediaDriver()
    const permission = await driver.requestMediaLibraryPermissionsAsync(false)
    const permissionGranted = permission.granted === true || permission.status === 'granted'
    if (!permissionGranted) {
      return { canceled: true, permissionGranted }
    }

    const result = await driver.launchImageLibraryAsync({
      allowsEditing: options.allowsEditing,
      mediaTypes: ['images'],
      quality: options.quality,
    })
    if (result.canceled) {
      return { canceled: true, permissionGranted }
    }

    const image = normalizeImage(result.assets?.[0])
    return image ? { canceled: false, image, permissionGranted } : { canceled: true, permissionGranted }
  },

  /** pickImageAction creates a Pressable-compatible async action that picks an image. */
  pickImageAction(
    options: TaoImagePickOptions = {},
    picked?: TaoImagePickedAction,
  ): TaoMediaAction {
    return {
      async invoke() {
        const result = await Media.pickImage(options)
        picked?.invoke(result)
      },
    }
  },

  /** pickedAction adapts image-pick results into a Media-compatible action. */
  pickedAction(work: (result: TaoImagePickResult) => void): TaoImagePickedAction {
    return {
      invoke(result) {
        work(result)
      },
    }
  },

  /** setDriverForTests replaces Expo Image Picker for deterministic runtime tests. */
  setDriverForTests(driver?: TaoMediaDriver): void {
    testDriver = driver
  },
} as const

function mediaDriver(): TaoMediaDriver {
  if (testDriver) {
    return testDriver
  }

  return require('expo-image-picker') as TaoMediaDriver
}

function normalizeImage(asset: ExpoImagePickAsset | null | undefined): TaoPickedImage | undefined {
  if (!asset) {
    return undefined
  }
  return {
    ...(asset.fileName ? { fileName: asset.fileName } : {}),
    height: asset.height ?? 0,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    uri: asset.uri,
    width: asset.width ?? 0,
  }
}
