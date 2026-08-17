import type { NetInfoState } from '@react-native-community/netinfo'

export type TaoNetworkStatus = {
  isConnected: boolean
  isInternetReachable: boolean | null
  isOnline: boolean
  isUnknown: boolean
  type: string
}

type NetInfoModule = {
  default?: {
    useNetInfo(): NetInfoState
  }
  useNetInfo(): NetInfoState
}

let statusSource: () => TaoNetworkStatus = netInfoStatus

/** Network exposes React Native network reachability through NetInfo. */
export const Network = {
  /** status reads the current connection status and re-renders when NetInfo changes. */
  status(): TaoNetworkStatus {
    return statusSource()
  },

  /** setStatusForTests replaces NetInfo with deterministic runtime test status. */
  setStatusForTests(status?: Partial<TaoNetworkStatus>): void {
    statusSource = status ? () => normalizeStatus(status) : netInfoStatus
  },
} as const

function netInfoStatus(): TaoNetworkStatus {
  if (isJestRuntime()) {
    return normalizeStatus({ type: 'unknown', isUnknown: true })
  }

  const module = require('@react-native-community/netinfo') as NetInfoModule
  const netInfo = (module.default ?? module).useNetInfo()
  return normalizeStatus({
    isConnected: netInfo.isConnected === true,
    isInternetReachable: netInfo.isInternetReachable,
    type: netInfo.type,
  })
}

function normalizeStatus(status: Partial<TaoNetworkStatus>): TaoNetworkStatus {
  const isConnected = status.isConnected ?? false
  const isInternetReachable = status.isInternetReachable ?? null
  return {
    isConnected,
    isInternetReachable,
    isOnline: status.isOnline ?? (isConnected && isInternetReachable !== false),
    isUnknown: status.isUnknown ?? status.type === 'unknown',
    type: status.type ?? 'unknown',
  }
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
