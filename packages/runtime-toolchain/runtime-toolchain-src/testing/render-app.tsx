import { render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'
import type { RuntimeApp } from './RuntimeApp'

export type { CompiledRuntimeApp, RuntimeScreen } from './RuntimeApp'

/** renderCompiledApp renders a previously compiled runtime test app. */
export function renderCompiledApp(compiledApp: RuntimeApp.Compiled): RuntimeApp.Screen {
  const appModule = require(compiledApp.testAppPath) as { default: ComponentType }
  return render(createElement(appModule.default))
}
