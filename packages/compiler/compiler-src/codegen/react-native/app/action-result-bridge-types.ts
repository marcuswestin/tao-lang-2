import type { BridgeMetadata } from '../../../bridge-metadata'

type BridgeTypeOptions = NonNullable<Parameters<typeof BridgeMetadata.resultType>[1]>
let activeOptions: BridgeTypeOptions | undefined

/** Source-module emission is synchronous; nested emission restores its caller's type context. */
export function withActionResultBridgeTypes<T>(options: BridgeTypeOptions, emit: () => T): T {
  const previous = activeOptions
  activeOptions = options
  try {
    return emit()
  } finally {
    activeOptions = previous
  }
}

export function actionResultBridgeTypeOptions(): BridgeTypeOptions | undefined {
  return activeOptions
}
