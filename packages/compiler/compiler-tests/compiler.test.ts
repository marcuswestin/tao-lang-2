import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../compiler-src/compiler'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const kitchenSinkPath = resolve(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')
const tsFence = '```ts'
const fence = '```'

describe('minimal Tao compiler', () => {
  test('compiles the current Kitchen Sink app to Expo-compatible TSX', async () => {
    const compiled = await Compiler.compileFile(kitchenSinkPath)

    expectKitchenSinkOutput(compiled.code)
  })

  test('compiles Tao source strings', async () => {
    const source = await readFile(kitchenSinkPath, 'utf8')
    const compiled = await Compiler.compileCode(source)

    expectKitchenSinkOutput(compiled.code)
  })

  test('rejects duplicate app root ui declarations', async () => {
    await expect(Compiler.compileCode(`
      app MyApp {
        ui MainView
        ui OtherView
      }
      ui MainView { }
      ui OtherView { }
    `)).rejects.toThrow('must declare exactly one root ui')
  })

  test('rejects app blocks without a root ui statement', async () => {
    await expect(Compiler.compileCode(`
      app MyApp {
        ui MainView { }
      }
      ui MainView { }
    `)).rejects.toThrow('must declare exactly one root ui')
  })

  test('supports nested render children in generated view props', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Box {
          render Text "Hello"
        }
      }
      ui Box { }
      ui Text Value text {
        render inject ${tsFence}
          const text = _ViewProps.Value.evaluate()
          return <RN.Text>{text}</RN.Text>
        ${fence}
      }
    `)

    expect(compiled.code).toContain('function Box(_ViewProps: { children?: React.ReactNode })')
    expect(compiled.code).toContain('return _ViewProps.children ?? null')
    expect(compiled.code).toContain('<Box>')
    expect(compiled.code).toContain('</Box>')
  })

  test('rejects inject in multi-statement view blocks explicitly', async () => {
    await expect(Compiler.compileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return <RN.Text>Hello</RN.Text>
        ${fence}
        render MainView
      }
    `)).rejects.toThrow('Only view renders are supported in multi-statement blocks')
  })

  test('rejects unsupported inject blocks explicitly', async () => {
    await expect(Compiler.compileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          const text = "Hello"
        ${fence}
      }
    `)).rejects.toThrow('Unsupported inject block')
  })
})

function expectKitchenSinkOutput(code: string): void {
  expect(code).toContain('Hello, World!')
  expect(code).toContain('function MainView')
  expect(code).toContain('function Text')
  expect(code).toContain('_ViewProps.Value')
  expect(code).toContain('<RN.Text>{text.jsValue}</RN.Text>')
  expect(code).toContain('export default function')
}
