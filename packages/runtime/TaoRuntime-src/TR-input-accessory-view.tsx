import React from 'react'

export type TaoInputAccessoryProps = {
  backgroundColor?: string
  children?: React.ReactNode
  nativeID: string
}

export type TaoInputAccessoryDriver = {
  InputAccessoryView: React.ComponentType<TaoInputAccessoryProps>
}

let testDriver: TaoInputAccessoryDriver | undefined

/** InputAccessory exposes React Native iOS input accessory helpers. */
export const InputAccessory = {
  /** id creates a stable native ID for matching TextInput accessory views. */
  id(name: string): string {
    return `tao-input-accessory-${name}`
  },

  /** View renders a React Native InputAccessoryView. */
  View(props: TaoInputAccessoryProps): React.ReactElement {
    const AccessoryView = inputAccessoryDriver().InputAccessoryView
    return <AccessoryView {...props} />
  },

  /** textInputProps returns props that attach a TextInput to an accessory view. */
  textInputProps(nativeID: string): { inputAccessoryViewID: string } {
    return { inputAccessoryViewID: nativeID }
  },

  /** setDriverForTests replaces React Native InputAccessoryView for deterministic runtime tests. */
  setDriverForTests(driver?: TaoInputAccessoryDriver): void {
    testDriver = driver
  },
} as const

function inputAccessoryDriver(): TaoInputAccessoryDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      InputAccessoryView(props) {
        return <>{props.children}</>
      },
    }
  }

  const RN = require('react-native') as { InputAccessoryView: React.ComponentType<TaoInputAccessoryProps> }
  return { InputAccessoryView: RN.InputAccessoryView }
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
