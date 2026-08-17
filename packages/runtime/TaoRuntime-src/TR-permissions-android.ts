export type TaoAndroidPermission = string

export type TaoAndroidPermissionStatus = 'denied' | 'granted' | 'never_ask_again'

export type TaoAndroidPermissionRationale = {
  buttonNegative?: string
  buttonNeutral?: string
  buttonPositive?: string
  message: string
  title: string
}

export type TaoAndroidPermissionsRequest = {
  permission: TaoAndroidPermission
  rationale?: TaoAndroidPermissionRationale
}

export type TaoAndroidPermissionsAction = {
  invoke(): Promise<TaoAndroidPermissionStatus>
}

export type TaoAndroidPermissionRequestedAction = {
  invoke(status: TaoAndroidPermissionStatus): void
}

export type TaoPermissionsAndroidDriver = {
  check(permission: TaoAndroidPermission): Promise<boolean>
  request(permission: TaoAndroidPermission, rationale?: TaoAndroidPermissionRationale): Promise<string>
  requestMultiple(permissions: readonly TaoAndroidPermission[]): Promise<Record<TaoAndroidPermission, string>>
  PERMISSIONS?: Record<string, TaoAndroidPermission>
  RESULTS?: Record<string, string>
}

let testDriver: TaoPermissionsAndroidDriver | undefined

/** PermissionsAndroid exposes React Native Android runtime permission helpers. */
export const PermissionsAndroid = {
  /** check resolves whether an Android permission has already been granted. */
  async check(permission: TaoAndroidPermission): Promise<boolean> {
    return permissionsAndroidDriver().check(permission)
  },

  /** request asks Android for a single runtime permission and normalizes the result. */
  async request(request: TaoAndroidPermissionsRequest): Promise<TaoAndroidPermissionStatus> {
    const result = await permissionsAndroidDriver().request(request.permission, request.rationale)
    return normalizePermissionStatus(result)
  },

  /** requestMany asks Android for several runtime permissions and normalizes their results. */
  async requestMany(
    permissions: readonly TaoAndroidPermission[],
  ): Promise<Record<TaoAndroidPermission, TaoAndroidPermissionStatus>> {
    const results = await permissionsAndroidDriver().requestMultiple(permissions)
    return Object.fromEntries(
      Object.entries(results).map(([permission, status]) => [permission, normalizePermissionStatus(status)]),
    )
  },

  /** requestAction creates a Pressable-compatible async Android permission action. */
  requestAction(
    request: TaoAndroidPermissionsRequest,
    requested?: TaoAndroidPermissionRequestedAction,
  ): TaoAndroidPermissionsAction {
    return {
      async invoke() {
        const status = await PermissionsAndroid.request(request)
        requested?.invoke(status)
        return status
      },
    }
  },

  /** requestedAction adapts Android permission results into a PermissionsAndroid-compatible action. */
  requestedAction(work: (status: TaoAndroidPermissionStatus) => void): TaoAndroidPermissionRequestedAction {
    return {
      invoke(status) {
        work(status)
      },
    }
  },

  /** permission returns a React Native Android permission constant when available. */
  permission(name: string): TaoAndroidPermission {
    return permissionsAndroidDriver().PERMISSIONS?.[name] ?? name
  },

  /** setDriverForTests replaces React Native PermissionsAndroid for deterministic runtime tests. */
  setDriverForTests(driver?: TaoPermissionsAndroidDriver): void {
    testDriver = driver
  },
} as const

function permissionsAndroidDriver(): TaoPermissionsAndroidDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      async check() {
        return false
      },
      async request() {
        return 'denied'
      },
      async requestMultiple(permissions) {
        return Object.fromEntries(permissions.map(permission => [permission, 'denied']))
      },
      PERMISSIONS: {},
      RESULTS: {
        DENIED: 'denied',
        GRANTED: 'granted',
        NEVER_ASK_AGAIN: 'never_ask_again',
      },
    }
  }

  const RN = require('react-native') as { PermissionsAndroid: TaoPermissionsAndroidDriver }
  return RN.PermissionsAndroid
}

function normalizePermissionStatus(status: string): TaoAndroidPermissionStatus {
  return status === 'granted' || status === 'never_ask_again' ? status : 'denied'
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
