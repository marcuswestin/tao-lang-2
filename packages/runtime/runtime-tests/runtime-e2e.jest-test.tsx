import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { cleanup, render } from '@testing-library/react-native'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type ComponentType, createElement } from 'react'

afterEach(() => cleanup())

describe('Expo runtime', () => {
  test('compiles and renders Kitchen Sink Hello World', async () => {
    const repoRoot = resolve(__dirname, '../../..')
    const generatedAppPath = resolve(repoRoot, 'packages/runtime/_gen_tao-app/App.tsx')

    expect(readFileSync(generatedAppPath, 'utf8')).toContain('Hello, World!')
    jest.resetModules()
    const appModule = require(generatedAppPath) as { default: ComponentType }
    const screen = render(createElement(appModule.default))

    expect(screen.getByText('Hello, World!')).toBeDefined()
  })
})
