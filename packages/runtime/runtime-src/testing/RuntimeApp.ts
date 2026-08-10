/** RuntimeApp groups shared runtime-test app and screen types. */
export namespace RuntimeApp {
  /** Compiled represents an isolated generated app module ready to render in Jest. */
  export type Compiled = {
    testAppPath: string
  }

  /** Screen represents a rendered React Native Testing Library app screen. */
  export type Screen = ReturnType<typeof import('@testing-library/react-native').render>

  /** Element represents one matched node in a rendered app screen. */
  export type Element = ReturnType<Screen['queryAllByText']>[number]
}

/** CompiledRuntimeApp represents an isolated generated app module ready to render in Jest. */
export type CompiledRuntimeApp = RuntimeApp.Compiled

/** RuntimeScreen represents a rendered React Native Testing Library app screen. */
export type RuntimeScreen = RuntimeApp.Screen
