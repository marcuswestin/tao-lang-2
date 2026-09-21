import React from 'react'
import { createElement } from './TR-create-element'
import type { TaoAppDefinition, TaoNavigationArguments } from './TR-navigation'
import { RuntimeAppDefinition } from './TR-navigation-app'
import { NavigationAppHost } from './TR-navigation-app-host'

/** Creates an inert synthetic app; only a committed host activates it in process-wide registries. */
export function createStudioSubjectApp(
  definition: (arguments_: TaoNavigationArguments) => TaoAppDefinition,
  arguments_: TaoNavigationArguments,
): RuntimeAppDefinition {
  return new RuntimeAppDefinition(definition(arguments_), { deferredRegistration: true })
}

/**
 * The navigation host a Studio cell gives one focused view.
 *
 * A `render ViewName(...)` scenario used to mount its view directly under `AppShell`, with no
 * navigator anywhere above it. That is fine until the view does what views are allowed to do: a row
 * that opens its own screen, a button that presents a detail — `present` then found no enclosing
 * navigation and the cell died with 'no enclosing or explicit navigation target'. Studio's whole
 * claim is that a focused view behaves the way it behaves in the app, and in the app there is
 * always a navigator above it.
 *
 * The host is a real app definition whose navigator is a slot holding the focused view, which is
 * the same shape `app Name { View Something }` already compiles to. That buys the behavior rather
 * than simulating it: `present` swaps the slot, the app host draws Back, toasts and overlays land
 * where they land in the app, and the design comes from the app the scenario names.
 *
 * It is built per mount and disposed with the cell. Restoration is `fresh`, so a preview cell reads
 * and writes no stored position: two scenarios of one view differ by fixture, and a stack restored
 * across them names rows the other one does not have.
 */
export function StudioSubjectHost(props: {
  arguments: TaoNavigationArguments
  definition: (arguments_: TaoNavigationArguments) => TaoAppDefinition
}): React.JSX.Element {
  // Lazy initial state rather than a memo: a cell remounts whenever its scenario or revision
  // changes, so "once per mount" is exactly the lifetime this host wants, and there is no
  // dependency list to keep honest.
  const [app] = React.useState(() => createStudioSubjectApp(props.definition, props.arguments))
  const lifecycleGeneration = React.useRef(0)
  React.useEffect(() => {
    lifecycleGeneration.current += 1
    app.commitRegistration()
    return () => {
      const cleanupGeneration = ++lifecycleGeneration.current
      // StrictMode deliberately replays an effect's setup/cleanup/setup against the same state
      // object. Defer destructive disposal by one microtask so the second setup can claim the app;
      // a real unmount has no setup to advance the generation and therefore still releases it.
      queueMicrotask(() => {
        if (lifecycleGeneration.current === cleanupGeneration) {
          app.dispose()
        }
      })
    }
  }, [app])
  return createElement(NavigationAppHost, { app })
}
