import React from 'react'
import { errorMessage } from './TR-errors'
import { requireReactNativeRuntime } from './TR-react-native'

type DataLoadFailure = Readonly<{
  actionLabel: string
  id: number
  message: string
  recover: () => Promise<void>
  source: object
}>

type DataLoadRecoveryBoundaryProps = {
  children?: React.ReactNode
}

const listeners = new Set<() => void>()
let activeFailure: DataLoadFailure | undefined
let nextFailureId = 0
let reloadRevision = 0
let revision = 0

const styles = {
  button: {
    alignItems: 'center',
    backgroundColor: '#b91c1c',
    borderRadius: 7,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  message: { color: '#374151', fontSize: 14, lineHeight: 20 },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.56)',
    bottom: 0,
    elevation: 20000,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20000,
  },
  panel: {
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 10,
    gap: 14,
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  title: { color: '#111827', fontSize: 18, fontWeight: '700' },
} as const

/** DataLoadRecovery is the private seam between provider loading and the app recovery boundary. */
export const DataLoadRecovery = {
  report(source: object, message: string, recovery: { label: string; run: () => Promise<void> }): void {
    activeFailure = {
      actionLabel: recovery.label,
      id: ++nextFailureId,
      message,
      recover: recovery.run,
      source,
    }
    emit()
  },

  resolve(source: object): void {
    if (activeFailure?.source !== source) {
      return
    }
    activeFailure = undefined
    emit()
  },
} as const

/** DataLoadRecoveryBoundary blocks a failed app and remounts it after provider-defined recovery. */
export function DataLoadRecoveryBoundary(props: DataLoadRecoveryBoundaryProps): React.JSX.Element {
  React.useSyncExternalStore(subscribe, snapshot, snapshot)
  const failure = activeFailure

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(React.Fragment, { key: reloadRevision }, props.children),
    failure
      ? React.createElement(DataLoadFailureOverlay, { failure, key: failure.id })
      : null,
  )
}

function DataLoadFailureOverlay(props: { failure: DataLoadFailure }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const [recoveryError, setRecoveryError] = React.useState('')
  const [recovering, setRecovering] = React.useState(false)
  const buttonLabel = recovering ? 'Recovering…' : props.failure.actionLabel
  React.useEffect(() => {
    const subscription = RN.BackHandler?.addEventListener('hardwareBackPress', () => true)
    return () => subscription?.remove()
  }, [RN.BackHandler])

  return React.createElement(
    RN.View,
    {
      accessibilityLabel: 'App data load failure',
      accessibilityViewIsModal: true,
      style: styles.overlay,
    },
    React.createElement(
      RN.View,
      { style: styles.panel },
      React.createElement(RN.Text, { style: styles.title }, "Couldn't load app data"),
      React.createElement(RN.Text, { style: styles.message }, props.failure.message),
      recoveryError ? React.createElement(RN.Text, { style: styles.message }, recoveryError) : null,
      React.createElement(
        RN.Pressable,
        {
          accessibilityLabel: buttonLabel,
          accessibilityRole: 'button',
          disabled: recovering,
          onPress: async () => {
            setRecovering(true)
            setRecoveryError('')
            try {
              await props.failure.recover()
              completeRecovery(props.failure)
            } catch (error) {
              setRecovering(false)
              setRecoveryError(`Could not recover app data: ${errorMessage(error)}`)
            }
          },
          style: [styles.button, recovering ? styles.buttonDisabled : undefined],
        },
        React.createElement(RN.Text, { style: styles.buttonText }, buttonLabel),
      ),
    ),
  )
}

function completeRecovery(failure: DataLoadFailure): void {
  if (activeFailure !== undefined && activeFailure.source !== failure.source) {
    return
  }
  activeFailure = undefined
  reloadRevision += 1
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): number {
  return revision
}

function emit(): void {
  revision += 1
  for (const listener of listeners) {
    listener()
  }
}
