import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import {
  checkedProjectFile,
  packageAwareCliFixture,
  packageAwareCliMainPath,
  packageAwareCliPathCases,
  statusByFile,
  withGitTaoFixture,
  withTaoFixture,
} from './test-cli-files'

Describe('tao check', () => {
  // FS-D2: a Placeholder that would ship warns wherever it is authored, including a Studio-owned
  // generated view a sketch snapped into; only test source is exempt because it never ships.
  Test(
    'reports shipping warnings for authored and Studio generated Placeholder renders but exempts test source',
    async () => {
      await withTaoFixture({
        ...checkedProjectFile,
        '@/studio/View1.tao':
          'use Placeholder from @tao/ui\n\npublic\nview View1() {\n   render Placeholder("View1")\n}\n',
        'App.tao': 'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Main")\n}\n',
        'Placeholder.test.tao':
          'use Placeholder from @tao/ui\n\nview TestDraft() {\n   render Placeholder("Test draft")\n}\n',
      }, async rootDir => {
        const results = await runCheck(rootDir)
        const authored = results.find(result => FS.basename(result.path) === 'App.tao')
        const generated = results.find(result => FS.basename(result.path) === 'View1.tao')
        const testSource = results.find(result => FS.basename(result.path) === 'Placeholder.test.tao')

        Expect(authored?.diagnostics).toHaveLength(1)
        Expect(authored?.diagnostics?.[0]?.message).toContain('Placeholder ships as an empty box in release.')
        Expect(generated?.diagnostics).toHaveLength(1)
        Expect(generated?.diagnostics?.[0]?.message).toContain('Placeholder ships as an empty box in release.')
        Expect(testSource?.diagnostics).toBeUndefined()
        Expect(statusByFile(results, rootDir)).toEqual({
          '@/studio/View1.tao': 'unchanged',
          'App.tao': 'unchanged',
          'Placeholder.test.tao': 'unchanged',
        })
      })
    },
  )

  Test('validates nested Tao projects with their own generated-root ownership', async () => {
    await withTaoFixture({
      'Nested/.tao/.gitkeep': '',
      'Nested/@/studio/View1.tao':
        'use Placeholder from @tao/ui\n\npublic\nview View1() {\n   render Placeholder("Generated")\n}\n',
      'Nested/Authored.tao': 'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Authored")\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const generated = results.find(result => result.path.endsWith('/@/studio/View1.tao'))
      const authored = results.find(result => result.path.endsWith('/Authored.tao'))

      Expect(generated?.diagnostics).toHaveLength(1)
      Expect(generated?.diagnostics?.[0]?.message).toContain('Placeholder ships as an empty box in release.')
      Expect(authored?.diagnostics).toHaveLength(1)
      Expect(authored?.diagnostics?.[0]?.message).toContain('Placeholder ships as an empty box in release.')
    })
  })

  Test('reports drift without writing', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'drift.tao': 'view   MainView() { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('drift.tao', rootDir)
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'drift.tao': 'changed' })
      Expect(await FS.readText(path)).toBe('view   MainView() { }')
    })
  })

  // Before this, a file that did not parse produced only the source-fix assertion's `Expected: …`
  // text, which named neither the position nor what the parser had been looking for.
  Test('reports a syntax error as a positioned parser diagnostic, not as an assertion message', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'broken.tao': 'view Broken() {\n   render Text(\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const broken = results.find(result => FS.basename(result.path) === 'broken.tao')

      Expect(broken?.status).toBe('error')
      Expect(broken?.error).toBeUndefined()
      Expect(broken?.diagnostics).toHaveLength(1)
      Expect(broken?.diagnostics?.[0]?.severity).toBe('error')
      Expect(broken?.diagnostics?.[0]?.source).toBe('parser')
      Expect(broken?.diagnostics?.[0]?.filePath).toBe(FS.resolvePath('broken.tao', rootDir))
      Expect(broken?.diagnostics?.[0]?.range?.start.line).toBe(2)
      Expect(broken?.diagnostics?.[0]?.message).not.toContain('Expected: Tao source without syntax errors')
    })
  })

  // The providers that write these sentences are registered on the language container rather than
  // applied to the text afterwards, so this proves the wiring holds all the way out to the command:
  // a lexer error, then a parser error whose alternatives are too many to list.
  Test('states lexer and parser syntax errors in Tao words', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'stray-brace.tao': 'view Main() {\n}\n}\n',
      'view-member.tao': 'view Broken() {\n   Text is "hi"\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const messageByFile = Object.fromEntries(
        results.map(result => [FS.basename(result.path), result.diagnostics?.[0]?.message]),
      )

      Expect(messageByFile).toEqual({
        'stray-brace.tao': 'Expected an open block for this `}` to close, but none is open here.',
        'view-member.tao': 'Expected a view member here, but found `Text`.',
      })
    })
  })

  // One stray word makes the parser mis-read the token after it, so `Text is "hi"` alone produces
  // three messages about the same word. Reporting the first on each line leaves the two places a
  // reader actually has to go.
  Test('reports each separate syntax mistake once, not the cascade behind it', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'broken.tao': 'view One() {\n   Text is "hi"\n}\n\nview Two {\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const broken = results.find(result => FS.basename(result.path) === 'broken.tao')

      Expect(broken?.diagnostics?.map(diagnostic => [diagnostic.range?.start.line, diagnostic.message])).toEqual([
        [1, 'Expected a view member here, but found `Text`.'],
        [4, 'Expected `(` or `=` here, but found `{`.'],
      ])
      Expect(broken?.unreportedDiagnostics).toBe(0)
    })
  })

  // Chevrotain's end-of-file token carries NaN rather than nothing, which reached the reader as
  // `NaN:NaN` and, because NaN never equals itself, slipped past the first-error-per-line filter
  // and let the formatter's own assertion through behind it.
  Test('positions an error at the end of the file under the last thing the author wrote', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'no-newline.tao': 'view Broken() {',
      'trailing-newline.tao': 'view Broken() {\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const reported = results.map(result => [
        FS.basename(result.path),
        result.diagnostics?.length,
        result.error,
        result.diagnostics?.[0]?.range?.start,
      ])

      Expect(reported).toEqual([
        ['no-newline.tao', 1, undefined, { line: 0, character: 14 }],
        ['trailing-newline.tao', 1, undefined, { line: 0, character: 14 }],
      ])
    })
  })

  // The parser error here sits at an earlier column than the lexer error, so source order alone
  // would report the consequence and hide the character that caused it.
  Test('leads a line with its lexer error even when a parser error precedes it', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'broken.tao': 'view Main() {\n   let x = §\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const broken = results.find(result => FS.basename(result.path) === 'broken.tao')

      Expect(broken?.diagnostics).toHaveLength(1)
      Expect(broken?.diagnostics?.[0]?.source).toBe('lexer')
      Expect(broken?.diagnostics?.[0]?.message).toContain('but found `§`.')
    })
  })

  // Past three the list stops being something a reader starts from, so the rest is held back and
  // counted instead of printed.
  Test('holds back a badly broken file past the first three lines, and says how many', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'broken.tao': 'view Main( {\n   render Text "a"\n   render Text("b"\n   Text is 1\nview Two {\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const broken = results.find(result => FS.basename(result.path) === 'broken.tao')

      Expect(broken?.diagnostics?.map(diagnostic => diagnostic.range?.start.line)).toEqual([0, 1, 2])
      Expect(broken?.unreportedDiagnostics).toBeGreaterThan(0)
    })
  })

  // The canonical newcomer mistake: rendering a view that was never declared or imported. It used
  // to produce no output at all, because only warnings reached the command.
  Test('reports an unresolved render target as a positioned error', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': 'view Main() {\n   render NoSuchView()\n}\n',
    }, async rootDir => {
      const [result] = await runCheck(rootDir)
      const [diagnostic] = result?.diagnostics ?? []

      Expect(result?.status).toBe('unchanged')
      Expect(diagnostic?.severity).toBe('error')
      Expect(diagnostic?.message).toBe("No view named 'NoSuchView' is in scope.")
      Expect(diagnostic?.filePath).toBe(FS.resolvePath('App.tao', rootDir))
      Expect(diagnostic?.range?.start).toEqual({ line: 1, character: 10 })
    })
  })

  Test('reports errors and warnings on the same file together', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao':
        'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Main")\n}\n\nview Other() {\n   render NoSuchView()\n}\n',
    }, async rootDir => {
      const [result] = await runCheck(rootDir)
      const severities = (result?.diagnostics ?? []).map(diagnostic => diagnostic.severity)

      Expect(severities).toContain('error')
      Expect(severities).toContain('warning')
    })
  })

  Test('walks non-git fixture directories without applying loose gitignore files', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      '.gitignore': 'node_modules\n.artifacts\n.custom-hidden\nAndroid\nIOS\nPods\npods\n',
      'canonical.tao': 'view MainView() { }\n',
      'node_modules/pkg/ignored.tao': 'view   Ignored() { }',
      '.artifacts/ignored.tao': 'view   Ignored() { }',
      '.custom-hidden/ignored.tao': 'view   Ignored() { }',
      'Android/ignored.tao': 'view   Ignored() { }',
      'IOS/ignored.tao': 'view   Ignored() { }',
      'Pods/ignored.tao': 'view   Ignored() { }',
      'pods/ignored.tao': 'view   Ignored() { }',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
    })
  })

  Test('skips hidden future-source directories without reserving user directory names', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'canonical.tao': 'view MainView() { }\n',
      'Apps/WordFlower/.tao-archive/Future.tao': 'app FutureMVP {',
      'Apps/WordFlower/1 - Current/Valid.tao': 'view ValidCurrentMVP() { }\n',
      'Roadmap/Feature/Syntax Sketches/Valid.tao': 'view ValidSyntaxSketch() { }\n',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Apps/WordFlower/1 - Current/Valid.tao': 'unchanged',
        'Roadmap/Feature/Syntax Sketches/Valid.tao': 'unchanged',
        'canonical.tao': 'unchanged',
      })
    })
  })

  Test('skips an explicitly named ignored directory', async () => {
    await withGitTaoFixture({
      '.gitignore': 'node_modules\n',
      'node_modules/pkg/ignored.tao': 'view   Ignored() { }',
    }, async (rootDir) => {
      const directory = FS.resolvePath('node_modules', rootDir)

      Expect(await runCheck(directory)).toEqual([])
    })
  })

  for (const pathCase of packageAwareCliPathCases) {
    Test(`uses package-aware workspace roots for ${pathCase.name}`, async () => {
      await withTaoFixture({
        'Packages/.tao/.gitkeep': '',
        'Packages/Package.tao': 'package { name "Cards" version 1.0.0 includes @cards }\n',
        ...packageAwareCliFixture,
      }, async rootDir => {
        const target = pathCase.resolve(rootDir)
        const results = await runCheck(target.path, { cwd: target.cwd })
        const sourcePath = FS.resolvePath(packageAwareCliMainPath, rootDir)

        Expect(statusByFile(results, rootDir)).toEqual({
          [packageAwareCliMainPath]: 'changed',
          'Packages/@cards/widgets/Widget.tao': 'diagnostics',
        })
        Expect(await FS.readText(sourcePath)).toContain('LocalText, Missing')
      })
    })
  }
})
