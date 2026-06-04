import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { FS, Repo } from '@shared'
import { cleanup, render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'

afterEach(() => cleanup())

describe('Expo runtime', () => {
  test('compiles and renders Kitchen Sink Hello World', async () => {
    const repoRoot = await Repo.getRoot()
    const generatedAppPath = FS.resolvePath(repoRoot, 'packages/runtime/_gen_tao-app/App.tsx')

    jest.resetModules()
    const appModule = require(generatedAppPath) as { default: ComponentType }
    const screen = render(createElement(appModule.default))

    expect(screen.getByText('Hello, World!')).toBeDefined()
  })
})
