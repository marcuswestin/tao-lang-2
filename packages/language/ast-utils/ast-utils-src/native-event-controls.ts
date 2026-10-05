import { AST } from '@parser'

/** NativeEventControls declares the synchronous policy attached to one event action value. */
export type NativeEventControls = {
  preventDefault?: true
  stopPropagation?: true
  stopImmediatePropagation?: true
}

export type NativeEventControlDiagnostic =
  | { kind: 'unknown-native-event-control'; control: AST.NativeEventControl }
  | { kind: 'duplicate-native-event-control'; control: AST.NativeEventControl }
  | { kind: 'unsupported-native-event-control'; control: AST.NativeEventControl; event: AST.EventName }
  | { kind: 'unsupported-native-event-controls'; handler: AST.EventHandler }

/** resolveNativeEventControls resolves closed control names without changing an action's signature. */
export function resolveNativeEventControls(handler: AST.EventHandler): {
  controls: NativeEventControls
  diagnostics: NativeEventControlDiagnostic[]
} {
  const controls: NativeEventControls = {}
  const diagnostics: NativeEventControlDiagnostic[] = []
  const seen = new Set<string>()
  for (const control of handler.controls?.controls ?? []) {
    const name = control.name
    if (seen.has(name)) {
      diagnostics.push({ kind: 'duplicate-native-event-control', control })
    }
    seen.add(name)
    if (name === 'preventDefault' || name === 'stopPropagation' || name === 'stopImmediatePropagation') {
      controls[name] = true
      // React Native synthetic press/submit events expose only these first two controls.
      if (name === 'stopImmediatePropagation' && handler.event !== 'change') {
        diagnostics.push({ kind: 'unsupported-native-event-control', control, event: handler.event })
      }
    } else {
      diagnostics.push({ kind: 'unknown-native-event-control', control })
    }
  }
  // Change adapters deliver a scalar rather than the native event control protocol.
  if (handler.controls && handler.event === 'change') {
    diagnostics.push({ kind: 'unsupported-native-event-controls', handler })
  }
  return { controls, diagnostics }
}
