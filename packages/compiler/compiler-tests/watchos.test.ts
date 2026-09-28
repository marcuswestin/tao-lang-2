import { Workspace } from '@compiler/workspace'
import { type Diagnostic, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { FunctionalCoreValidator } from '@validator/validators/FunctionalCoreValidator'
import { TargetCapabilitiesValidator } from '@validator/validators/target-capabilities-validator'
import { TestCompiler as Compiler } from './test-compile'

const source = `
use StackNav from @tao/nav
use Col, FormButton, ScrollView, Text from @tao/ui
app WatchHello { Name "Rep Counter" Navigator StackNav { Initial Workout } }
scene Workout() {
  Title "One set"
  let Goal = 12
  state Reps = 0
  action RecordRep() { check Reps < Goal set Reps += 1 }
  action Reset() { set Reps = 0 }
  render ScrollView() {
    Col()[gap 8, pad 8] {
      Text("{ Reps } of { Goal }")
      FormButton("Rep", Disabled: Reps >= Goal) { on press RecordRep }
      FormButton("Reset") { on press Reset }
    }
  }
}
`

Describe('compiler: watchOS SwiftUI', () => {
  Test('emits a native app, scalar state, guarded actions, and supported native views', async () => {
    const result = await Compiler.compileCode(source, { target: 'watchos' })
    Expect(result.target).toBe('watchos')
    Expect(result.entryArtifact).toBe('WatchApp.swift')
    Expect(result.displayName).toBe('Rep Counter')
    Expect(result.files.map(file => file.relativePath)).toEqual([
      'WatchApp.swift',
      'TaoScene_Workout.swift',
      'TaoValues.swift',
    ])
    Expect(result.code).toContain('NavigationStack')
    const scene = result.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code
    Expect(scene).toContain('@State var tao_Reps: Double = 0.0')
    Expect(scene).toContain('var tao_Goal: Double { 12.0 }')
    Expect(scene).toContain('guard (tao_Reps < tao_Goal) else { return }\n        tao_Reps += 1.0')
    Expect(scene).toContain('TaoValues.text(tao_Reps) + " of " + TaoValues.text(tao_Goal)')
    Expect(scene).toContain('.disabled((tao_Reps >= tao_Goal) || false)')
    Expect(scene).toContain('.navigationTitle("One set")')
    Expect(scene).toContain('VStack(alignment: .leading, spacing: 8)')
    Expect(scene).toContain('.padding(8)')
    Expect(result.validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  })

  Test('preserves the React Native default after relocating its emitters', async () => {
    const result = await Compiler.compileCode(source)
    Expect(result.code).toContain('TR.Navigation.App(')
    Expect(result.code).toContain('TR.State(')
    Expect(result.files.some(file => file.relativePath.endsWith('.tsx'))).toBe(true)
  })

  Test('emits a valid Swift exponent for large whole-valued numbers', async () => {
    const largeNumber = source.replace('let Goal = 12', 'let Goal = 1000000000000000000000')
    const result = await Compiler.compileCode(largeNumber, { target: 'watchos' })
    const scene = result.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code
    Expect(scene).toContain('var tao_Goal: Double { 1e+21 }')
    Expect(scene).not.toContain('1e+21.0')
  })

  Test('uses Tao numeric equality for NaN and signed zero, including inequality', async () => {
    const numericCases = source
      .replace('Reps >= Goal', '(0 / 0) == (0 / 0)')
      .replace('Reps < Goal', '-0 != 0')
    const result = await Compiler.compileCode(numericCases, { target: 'watchos' })
    const scene = result.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code
    Expect(scene).toContain('TaoValues.equal((0.0 / 0.0), (0.0 / 0.0))')
    Expect(scene).toContain('!TaoValues.equal((-0.0), 0.0)')
    const helper = result.files.find(file => file.relativePath === 'TaoValues.swift')!.code
    Expect(helper).toContain('if left.isNaN { return right.isNaN }')
    Expect(helper).toContain('if left == 0 && right == 0 { return left.sign == right.sign }')
  })

  Test('ships Tao text spellings for non-finite numeric values', async () => {
    const result = await Compiler.compileCode(source, { target: 'watchos' })
    const helper = result.files.find(file => file.relativePath === 'TaoValues.swift')!.code
    Expect(helper).toContain('if value.isNaN { return "NaN" }')
    Expect(helper).toContain('if value == .infinity { return "Infinity" }')
    Expect(helper).toContain('if value == -.infinity { return "-Infinity" }')
  })

  Test('compares text by UTF-16 identity and boolean values natively', async () => {
    const textCase = await Compiler.compileCode(source.replace('Reps >= Goal', '"é" == "é"'), { target: 'watchos' })
    const scene = textCase.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code
    Expect(scene).toContain('TaoValues.equal("é", "é")')
    const helper = textCase.files.find(file => file.relativePath === 'TaoValues.swift')!.code
    Expect(helper).toContain('left.utf16.elementsEqual(right.utf16)')
    const booleanCase = await Compiler.compileCode(source.replace('Reps >= Goal', 'true != false'), {
      target: 'watchos',
    })
    Expect(booleanCase.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code).toContain(
      '(true != false)',
    )
  })

  Test('rejects mixed primitive equality during ordinary Tao validation', async () => {
    await Expect(Compiler.compileCode(source.replace('Reps >= Goal', '1 == "1"'), { target: 'watchos' }))
      .rejects.toThrow(FunctionalCoreValidator.messages.binaryCompatible('=='))
  })

  Test('names scene output independently from fixed app and runtime artifacts', async () => {
    for (const name of ['WatchApp', 'TaoValues']) {
      const renamed = source.replace('Initial Workout', `Initial ${name}`).replace('scene Workout()', `scene ${name}()`)
      const result = await Compiler.compileCode(renamed, { target: 'watchos' })
      Expect(result.files.map(file => file.relativePath)).toEqual([
        'WatchApp.swift',
        `TaoScene_${name}.swift`,
        'TaoValues.swift',
      ])
      Expect(result.files[0]!.code).toContain(`TaoScene_${name}()`)
    }
  })

  Test('rejects a check after writes instead of changing transaction semantics', async () => {
    await Expect(
      Compiler.compileCode(source.replace('check Reps < Goal set Reps += 1', 'set Reps += 1 check Reps < Goal'), {
        target: 'watchos',
      }),
    )
      .rejects.toThrow(TargetCapabilitiesValidator.messages.checkAfterWrite('watchos'))
  })

  Test('rejects unsupported reached layout and asynchronous actions', async () => {
    await Expect(Compiler.compileCode(source.replace('gap 8, pad 8', 'gap 8, pad 8, fill'), { target: 'watchos' }))
      .rejects.toThrow(TargetCapabilitiesValidator.messages.unsupported('watchos', 'this layout clause'))
    await Expect(Compiler.compileCode(source.replace('set Reps = 0', 'async { set Reps = 0 }'), { target: 'watchos' }))
      .rejects.toThrow(
        TargetCapabilitiesValidator.messages.unsupported('watchos', "action statement 'AsyncActionStatement'"),
      )
  })

  Test('ignores unsupported content in an unselected app and preserves busy button behavior', async () => {
    const extra = '\napp Other { view OtherView }\nview OtherView() { render inject ```ts return null ``` }'
    const result = await Compiler.compileCode(
      source.replace('Disabled: Reps >= Goal', 'Disabled: Reps >= Goal, Submitting: Reps == 1') + extra,
      { target: 'watchos', appName: 'WatchHello' },
    )
    const scene = result.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code
    Expect(scene).toContain('Button(TaoValues.equal(tao_Reps, 1.0) ? "Saving…" : "Rep")')
    Expect(scene).toContain('.disabled((tao_Reps >= tao_Goal) || TaoValues.equal(tao_Reps, 1.0))')
    Expect(result.files.map(file => file.relativePath)).not.toContain('TaoScene_OtherView.swift')
  })

  Test('follows lexical aliases by declaration identity and rejects same-name replacements', async () => {
    const aliasSource = source.replace(
      'use Col, FormButton, ScrollView, Text from @tao/ui',
      `
      use Col, ScrollView, Text from @tao/ui
      use package @tao/ui as kit
      view FormButton = kit.FormButton
    `,
    )
    const result = await Compiler.compileCode(aliasSource, { target: 'watchos' })
    Expect(result.files.find(file => file.relativePath === 'TaoScene_Workout.swift')!.code).toContain(
      'Button(false ? "Saving…" : "Rep")',
    )
    const replacement = source.replace(
      'use Col, FormButton, ScrollView, Text from @tao/ui',
      `
      use Col, FormButton, ScrollView from @tao/ui
      view Text(Value text) { render inject \`\`\`ts return null \`\`\` }
    `,
    )
    await Expect(Compiler.compileCode(replacement, { target: 'watchos' }))
      .rejects.toThrow(
        TargetCapabilitiesValidator.messages.unsupported(
          'watchos',
          'unbound views, rendered navigators, or TypeScript injection',
        ),
      )
  })

  Test('reports unsupported source locations through the workspace API', async () => {
    await withTaoFiles('watchos-diagnostic-', { 'Watch.tao': source.replace('gap 8, pad 8', 'fill') }, async paths => {
      let captured: unknown
      try {
        await Workspace.compile(paths['Watch.tao'], { target: 'watchos' })
      } catch (error) {
        captured = error
      }
      Expect(captured).toBeDefined()
      Expect(String(captured)).toContain(
        TargetCapabilitiesValidator.messages.unsupported('watchos', 'this layout clause'),
      )
      const error = captured as { details: { diagnostics: Diagnostic[] } }
      const diagnostic = error.details.diagnostics[0]!
      Expect(diagnostic.source).toBe('validator')
      Expect(diagnostic.filePath).toBe(paths['Watch.tao'])
      Expect(diagnostic.nodeType).toBe('LayoutEntry')
      Expect(diagnostic.range?.start.line).toBe(10)
    })
  })

  Test('leaves TypeScript bridge metadata untouched for a watch workspace compile', async () => {
    await withTaoFiles('watchos-bridge-', { 'Watch.tao': source }, async paths => {
      const bridgePath = `${paths['Watch.tao']}.ts`
      const previous = '// Generated by Tao. Edit the .tao source\nexport type Previous = number\n'
      await FS.writeText(bridgePath, previous)
      const result = await Workspace.compile(paths['Watch.tao'], { target: 'watchos' })
      Expect(result.entryArtifact).toBe('WatchApp.swift')
      Expect(await FS.readText(bridgePath)).toBe(previous)
    })
  })
})
