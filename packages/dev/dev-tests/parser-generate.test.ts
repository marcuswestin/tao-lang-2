import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  acceptedDiagnosticReasons,
  type ParserGenerateOutcome,
  reviewParserGenerateOutput,
  runParserGenerate,
} from '../dev-src/repository-tests/ParserGenerate'

const CONFIG = {
  languages: [{
    fileExtensions: ['tao'],
    grammar: './parser-grammar/tao-grammar.langium',
    id: 'tao-lang',
    textMate: { out: '../ide-extension/ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json' },
  }],
  out: './parser-src/_gen_tao-parser',
  projectName: 'TaoLang',
}

const GENERATED = [
  'packages/ide-extension/ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
  'packages/parser/parser-src/_gen_tao-parser/ast.ts',
  'packages/parser/parser-src/_gen_tao-parser/grammar.ts',
]

/** repository builds a parser package skeleton with the same shape the real generator reads. */
async function repository(): Promise<string> {
  const root = await mkTestDir('tao-parser-generate-')
  await FS.writeJson(FS.resolvePath('packages/parser/langium-config.json', root), CONFIG)
  await FS.writeText(FS.resolvePath('packages/parser/parser-grammar/tao-grammar.langium', root), 'grammar TaoLang\n')
  await FS.writeText(FS.resolvePath('packages/parser/parser-grammar/views.langium', root), 'ViewDeclaration: "view";\n')
  return root
}

/** generator substitutes Langium, recording each call and writing the files Langium would write. */
function generator(outcome: Partial<ParserGenerateOutcome> = {}) {
  const calls: string[] = []
  const generate = async (parserRoot: string): Promise<ParserGenerateOutcome> => {
    calls.push(parserRoot)
    const root = FS.resolvePath('../..', parserRoot)
    for (const path of GENERATED) {
      await FS.writeText(FS.resolvePath(path, root), `generated ${calls.length}\n`)
    }
    return { exitCode: 0, output: '', ...outcome }
  }
  return { calls, generate }
}

Describe('parser generate staleness stamp', () => {
  Test('generates once and skips while the grammar and the generated files are unchanged', async () => {
    const root = await repository()
    const langium = generator()
    try {
      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)

      Expect(langium.calls.length).toBe(1)
      Expect(await FS.isFile(FS.resolvePath('.artifacts/parser-generate-stamp.json', root))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates when a generated file is deleted, whatever the stamp says', async () => {
    const root = await repository()
    const langium = generator()
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.remove(FS.resolvePath('packages/parser/parser-src/_gen_tao-parser/ast.ts', root))

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(langium.calls.length).toBe(2)
      Expect(await FS.readText(FS.resolvePath('packages/parser/parser-src/_gen_tao-parser/ast.ts', root)))
        .toContain('generated 2')
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates when generator-owned parser output is corrupted, not just when it is missing', async () => {
    const root = await repository()
    const langium = generator()
    const generated = FS.resolvePath('packages/parser/parser-src/_gen_tao-parser/ast.ts', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(generated, 'corrupted by an interrupted tool\n')

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(langium.calls.length).toBe(2)
      Expect(await FS.readText(generated)).toContain('generated 2')
    } finally {
      await FS.remove(root)
    }
  })

  Test('stays current when the IDE build post-processes the external TextMate grammar', async () => {
    const root = await repository()
    const langium = generator()
    const textMateGrammar = FS.resolvePath(GENERATED[0]!, root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(textMateGrammar, 'merged with the IDE overlay\n')

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(langium.calls).toHaveLength(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates when the TextMate grammar, written outside the parser package, is deleted', async () => {
    const root = await repository()
    const langium = generator()
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.remove(FS.resolvePath(GENERATED[0]!, root))

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(langium.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates on changed grammar content and skips again once it is reverted', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/parser/parser-grammar/views.langium', root)
    const original = await FS.readText(grammar)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, `${original}// changed\n`)
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      Expect(langium.calls.length).toBe(2)

      await FS.writeText(grammar, original)
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      Expect(langium.calls.length).toBe(3)
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates when the Langium configuration changes even though no grammar file did', async () => {
    const root = await repository()
    const langium = generator()
    const config = FS.resolvePath('packages/parser/langium-config.json', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeJson(config, { ...CONFIG, projectName: 'TaoLangRenamed' })

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(langium.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('never stamps a failed generation, so the next run repeats the work instead of skipping', async () => {
    const root = await repository()
    const langium = generator({ exitCode: 1 })
    try {
      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(1)
      Expect(await FS.exists(FS.resolvePath('.artifacts/parser-generate-stamp.json', root))).toBe(false)

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(1)
      Expect(langium.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('never stamps a run rejected for an undocumented diagnostic', async () => {
    const root = await repository()
    const langium = generator({
      output: 'parser-grammar/views.langium:1:1 - This rule is declared but never referenced.\n',
    })
    try {
      // The rejection path prints the offending diagnostic. Capture it: this fixture names a real
      // grammar file, so leaking it to the console reads as a genuine problem in the repository's
      // own grammar, which has cost several readers a detour.
      const rejected = await withCapturedOutput(async () =>
        await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      )

      Expect(rejected.result).toBe(1)
      Expect(rejected.stderr).toContain('This rule is declared but never referenced.')
      Expect(await FS.exists(FS.resolvePath('.artifacts/parser-generate-stamp.json', root))).toBe(false)
      Expect(langium.calls.length).toBe(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves no temporary stamp file behind', async () => {
    const root = await repository()
    const langium = generator()
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })

      Expect(await FS.listDir(FS.resolvePath('.artifacts', root))).toEqual(['parser-generate-stamp.json'])
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('parser generate diagnostic acceptance', () => {
  const sources = {
    'parser-grammar/actions.langium': `${'\n'.repeat(28)}CommandDeclaration:\n`,
    'parser-grammar/imports.langium': `${'\n'.repeat(18)}PackageMemberReference:\n`,
  }

  Test('accepts only the two documented false positives', () => {
    const review = reviewParserGenerateOutput(
      'parser-grammar/imports.langium:19:1 - This rule is declared but never referenced.\n'
        + 'parser-grammar/actions.langium:29:1 - This rule is declared but never referenced.\n',
      sources,
    )

    Expect(review.accepted.length).toBe(2)
    Expect(review.unexpected).toEqual([])
  })

  Test('rejects a new unreferenced rule declared in an otherwise accepted file', () => {
    const review = reviewParserGenerateOutput(
      'parser-grammar/imports.langium:3:1 - This rule is declared but never referenced.\n',
      { 'parser-grammar/imports.langium': '\n\nSomeNewRule:\n' },
    )

    Expect(review.accepted).toEqual([])
    Expect(review.unexpected.length).toBe(1)
  })

  Test('names both accepted diagnostics with the reason they are kept', () => {
    Expect(acceptedDiagnosticReasons()).toEqual([
      'PackageMemberReference is called by ViewDeclaration and TypeDeclaration in other grammar files',
      'CommandDeclaration is called by AppBlockDiagnosticStatement in blocks.langium',
    ])
  })
})
