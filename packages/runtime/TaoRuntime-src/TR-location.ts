export type TaoCoordinates = {
  accuracy: number | null
  altitude: number | null
  heading: number | null
  latitude: number
  longitude: number
  speed: number | null
}

export type TaoLocationResult = {
  coordinates?: TaoCoordinates
  permissionGranted: boolean
  timestamp?: number
}

export type TaoLocationDriver = {
  Accuracy?: {
    Balanced?: unknown
    High?: unknown
    Low?: unknown
  }
  getCurrentPositionAsync(options?: Record<string, unknown>): Promise<ExpoLocationObject>
  requestForegroundPermissionsAsync(): Promise<{ granted?: boolean; status?: string }>
}

export type TaoLocationAction = {
  invoke(): Promise<void>
}

export type TaoLocatedAction = {
  invoke(result: TaoLocationResult): void
}

type ExpoLocationObject = {
  coords: {
    accuracy?: number | null
    altitude?: number | null
    heading?: number | null
    latitude: number
    longitude: number
    speed?: number | null
  }
  timestamp?: number
}

type TaoLocationAccuracy = 'balanced' | 'high' | 'low'

type TaoLocationOptions = {
  accuracy?: TaoLocationAccuracy
}

let testDriver: TaoLocationDriver | undefined

/** Location exposes Expo Location-backed foreground position helpers. */
export const Location = {
  /** current requests foreground permission and reads the current device position. */
  async current(options: TaoLocationOptions = {}): Promise<TaoLocationResult> {
    const driver = locationDriver()
    const permission = await driver.requestForegroundPermissionsAsync()
    const permissionGranted = permission.granted === true || permission.status === 'granted'
    if (!permissionGranted) {
      return { permissionGranted }
    }

    const location = await driver.getCurrentPositionAsync({
      accuracy: locationAccuracy(driver, options.accuracy ?? 'balanced'),
    })
    return {
      coordinates: normalizeCoordinates(location.coords),
      permissionGranted,
      timestamp: location.timestamp,
    }
  },

  /** currentAction creates a Pressable-compatible action that reads the current position. */
  currentAction(options: TaoLocationOptions = {}, located?: TaoLocatedAction): TaoLocationAction {
    return {
      async invoke() {
        const result = await Location.current(options)
        located?.invoke(result)
      },
    }
  },

  /** locatedAction adapts foreground location results into a Location-compatible action. */
  locatedAction(work: (result: TaoLocationResult) => void): TaoLocatedAction {
    return {
      invoke(result) {
        work(result)
      },
    }
  },

  /** setDriverForTests replaces Expo Location for deterministic runtime tests. */
  setDriverForTests(driver?: TaoLocationDriver): void {
    testDriver = driver
  },
} as const

function locationDriver(): TaoLocationDriver {
  if (testDriver) {
    return testDriver
  }

  return require('expo-location') as TaoLocationDriver
}

function locationAccuracy(driver: TaoLocationDriver, accuracy: TaoLocationAccuracy): unknown {
  const expoAccuracy = driver.Accuracy
  if (!expoAccuracy) {
    return accuracy
  }
  return {
    balanced: expoAccuracy.Balanced,
    high: expoAccuracy.High,
    low: expoAccuracy.Low,
  }[accuracy]
}

function normalizeCoordinates(coords: ExpoLocationObject['coords']): TaoCoordinates {
  return {
    accuracy: coords.accuracy ?? null,
    altitude: coords.altitude ?? null,
    heading: coords.heading ?? null,
    latitude: coords.latitude,
    longitude: coords.longitude,
    speed: coords.speed ?? null,
  }
}
