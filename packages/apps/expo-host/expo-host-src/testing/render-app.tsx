import TR from '@runtime/TR'
import { render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'
import type { RuntimeApp } from './RuntimeApp'

export type { CompiledRuntimeApp, RuntimeScreen } from './RuntimeApp'

/** RenderCompiledAppOptions wraps a launch in the same fixture-seeding cell a Studio preview mounts. */
export type RenderCompiledAppOptions = {
  cell?: TR.StudioCellRuntime
}

/** renderCompiledApp renders a previously compiled runtime test app, optionally seeded from a fixture. */
export function renderCompiledApp(
  compiledApp: RuntimeApp.Compiled,
  options: RenderCompiledAppOptions = {},
): RuntimeApp.Screen {
  const appModule = require(compiledApp.testAppPath) as { default: ComponentType }
  const app = createElement(appModule.default)
  return render(
    options.cell ? createElement(TR.Studio.Environment.Host, { cell: options.cell, children: app }) : app,
  )
}
