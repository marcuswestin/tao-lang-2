import { CLI, Errors, FS, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  acceptedDiagnosticReasons,
  type ParserGenerateOutcome,
  reviewParserGenerateOutput,
  runParserGenerate,
} from '../verification-src/ParserGenerate'

const CONFIG = {
  languages: [{
    fileExtensions: ['tao'],
    grammar: './parser-grammar/tao-grammar.langium',
    id: 'tao-lang',
    textMate: { out: '../../ides/ide-extension/ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json' },
  }],
  out: './parser-src/_gen_tao-parser',
  projectName: 'TaoLang',
}

const GENERATED = [
  'packages/ides/ide-extension/ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
  'packages/language/parser/parser-src/_gen_tao-parser/ast.ts',
  'packages/language/parser/parser-src/_gen_tao-parser/grammar.ts',
]

/** repository builds a parser package skeleton with the same shape the real generator reads. */
async function repository(): Promise<string> {
  const root = await mkTestDir('tao-parser-generate-')
  await FS.writeJson(FS.resolvePath('packages/language/parser/langium-config.json', root), CONFIG)
  await FS.writeText(
    FS.resolvePath('packages/language/parser/parser-grammar/tao-grammar.langium', root),
    'grammar TaoLang\n',
  )
  await FS.writeText(
    FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root),
    'ViewDeclaration: "view";\n',
  )
  return root
}

/** generator substitutes Langium, recording each call and writing the files Langium would write. */
function generator(outcome: Partial<ParserGenerateOutcome> = {}) {
  const calls: string[] = []
  const generate = async (parserRoot: string): Promise<ParserGenerateOutcome> => {
    calls.push(parserRoot)
    const root = FS.resolvePath('../../..', parserRoot)
    for (const path of GENERATED) {
      await FS.writeText(FS.resolvePath(path, root), `generated ${calls.length}\n`)
    }
    return { exitCode: 0, output: '', ...outcome }
  }
  return { calls, generate }
}

Describe('parser generate staleness stamp', () => {
  Test('runs the real Langium CLI against staged copies of the repository grammar', async () => {
    const root = await mkTestDir('tao-parser-generate-real-')
    const parserRoot = FS.resolvePath('packages/language/parser', root)
    try {
      await FS.copyFile(
        Repo.resolvePath('packages/language/parser/langium-config.json'),
        FS.resolvePath('langium-config.json', parserRoot),
      )
      await FS.copyDirectory(
        Repo.resolvePath('packages/language/parser/parser-grammar'),
        FS.resolvePath('parser-grammar', parserRoot),
      )
      await FS.symlink(
        Repo.resolvePath('packages/language/parser/node_modules'),
        FS.resolvePath('node_modules', parserRoot),
      )

      Expect(await runParserGenerate({ repositoryRoot: root })).toBe(0)
      Expect(await FS.isFile(FS.resolvePath('parser-src/_gen_tao-parser/ast.ts', parserRoot))).toBe(true)
      Expect(
        await FS.isFile(
          FS.resolvePath(
            'packages/ides/ide-extension/ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
            root,
          ),
        ),
      ).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects an escaping real Langium output before the CLI can mutate it', async () => {
    const root = await mkTestDir('tao-parser-generate-escape-')
    const externalRoot = await mkTestDir('tao-parser-generate-external-')
    const parserRoot = FS.resolvePath('packages/language/parser', root)
    const sentinel = FS.resolvePath('sentinel.txt', externalRoot)
    try {
      const config = await FS.readJson<Record<string, unknown>>(
        Repo.resolvePath('packages/language/parser/langium-config.json'),
      )
      await FS.writeJson(FS.resolvePath('langium-config.json', parserRoot), { ...config, out: externalRoot })
      await FS.copyDirectory(
        Repo.resolvePath('packages/language/parser/parser-grammar'),
        FS.resolvePath('parser-grammar', parserRoot),
      )
      await FS.symlink(
        Repo.resolvePath('packages/language/parser/node_modules'),
        FS.resolvePath('node_modules', parserRoot),
      )
      await FS.writeText(sentinel, 'must survive\n')

      await Expect(runParserGenerate({ repositoryRoot: root })).rejects.toThrow(
        'staged parser output escapes its repository root',
      )
      Expect(await FS.readText(sentinel)).toBe('must survive\n')
    } finally {
      await FS.remove(externalRoot)
      await FS.remove(root)
    }
  })

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
      await FS.remove(FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root))

      Expect(await runParserGenerate({ generate: langium.generate, repositoryRoot: root })).toBe(0)
      Expect(langium.calls.length).toBe(2)
      Expect(await FS.readText(FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)))
        .toContain('generated 2')
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates when generator-owned parser output is corrupted, not just when it is missing', async () => {
    const root = await repository()
    const langium = generator()
    const generated = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
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
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
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

  Test('regenerates in host-temporary storage while the worktree tree stays in place', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    let generatedOutsideWorktree = false
    let previousTreeStayedVisible = false
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')

      Expect(
        await runParserGenerate({
          generate: async parserRoot => {
            generatedOutsideWorktree = !FS.pathIsWithin(parserRoot, root)
            previousTreeStayedVisible = await FS.isFile(generatedAst)
            return langium.generate(parserRoot)
          },
          repositoryRoot: root,
        }),
      ).toBe(0)

      Expect(generatedOutsideWorktree).toBe(true)
      Expect(previousTreeStayedVisible).toBe(true)
      Expect(await FS.readText(generatedAst)).toBe('generated 2\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('serializes independent generators and rechecks staleness after acquiring the lock', async () => {
    const root = await repository()
    const releasePath = FS.resolvePath('release-first', root)
    const modulePath = Repo.resolvePath('packages/testing/verification/verification-src/ParserGenerate.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const worker = (id: string, hold: boolean) => `
      import { Errors, FS, Platform, Time } from ${JSON.stringify(sharedPath)}
      import { runParserGenerate } from ${JSON.stringify(modulePath)}
      const root = Platform.runtimeProcess.env['TAO_PARSER_GENERATE_ROOT']
      if (!root) Errors.throwUnexpected('Missing parser generation root.')
      const result = await runParserGenerate({
        repositoryRoot: root,
        generate: async parserRoot => {
          await FS.writeText(FS.resolvePath(${JSON.stringify(`entered-${id}`)}, root), '')
          ${hold ? `while (!await FS.exists(${JSON.stringify(releasePath)})) await Time.sleep(5)` : ''}
          const stagingRoot = FS.resolvePath('../../..', parserRoot)
          for (const path of ${JSON.stringify(GENERATED)}) {
            await FS.writeText(FS.resolvePath(path, stagingRoot), ${JSON.stringify(`generated-${id}\n`)})
          }
          return { exitCode: 0, output: '' }
        },
      })
      Platform.runtimeProcess.setExitCode(result)
    `
    const run = (id: string, hold: boolean) =>
      CLI.run('bun', {
        args: ['-e', worker(id, hold)],
        env: { TAO_PARSER_GENERATE_ROOT: root },
        stdio: 'pipe',
      })
    const first = run('first', true)
    let second: Promise<CLI.CommandResult> | undefined
    try {
      Expect(
        await Time.pollUntil(async () => await FS.exists(FS.resolvePath('entered-first', root)), {
          intervalMs: 5,
          timeoutMs: 30_000,
        }),
      ).toBe(true)
      second = run('second', false)
      await Time.sleep(100)
      Expect(await FS.exists(FS.resolvePath('entered-second', root))).toBe(false)
      await FS.writeText(releasePath, '')
      const results = await Promise.all([first, second])
      Expect(results.map(result => result.exitCode)).toEqual([0, 0])
      Expect(await FS.exists(FS.resolvePath('entered-second', root))).toBe(false)
      Expect(await FS.readText(FS.resolvePath(GENERATED[1]!, root))).toBe('generated-first\n')
    } finally {
      await FS.writeText(releasePath, '').catch(() => {})
      await first.catch(() => undefined)
      await second?.catch(() => undefined)
      await FS.remove(root)
    }
  })

  Test('leaves the previous generated tree untouched when staged generation fails', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')

      Expect(
        await runParserGenerate({
          generate: async parserRoot => {
            const stagingRoot = FS.resolvePath('../../..', parserRoot)
            await FS.writeText(
              FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', stagingRoot),
              'partial failed generation\n',
            )
            return { exitCode: 1, output: 'generation failed\n' }
          },
          repositoryRoot: root,
        }),
      ).toBe(1)

      Expect(await FS.readText(generatedAst)).toBe('generated 1\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('publishes using file-only move and remove operations', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedRoot = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser', root)
    const staleFile = FS.resolvePath('stale.ts', generatedRoot)
    const calls: string[] = []
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      await FS.writeText(staleFile, 'stale generated output\n')

      Expect(
        await runParserGenerate({
          beforeMove: async (fromPath, toPath) => {
            if (await FS.isDirectory(fromPath) || await FS.isDirectory(toPath)) {
              Errors.throwUnexpected(`directory move attempted: ${fromPath}`)
            }
            calls.push(`move ${FS.basename(toPath)}`)
          },
          beforeRemove: async path => {
            if (await FS.isDirectory(path)) {
              Errors.throwUnexpected(`directory remove attempted: ${path}`)
            }
            calls.push(`remove ${FS.basename(path)}`)
          },
          generate: langium.generate,
          repositoryRoot: root,
        }),
      ).toBe(0)

      Expect(calls.some(call => call === 'remove stale.ts')).toBe(true)
      Expect(calls.some(call => call === 'move ast.ts')).toBe(true)
      Expect(await FS.exists(staleFile)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a worktree file-directory shape conflict before publishing', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      await FS.remove(generatedAst)
      await FS.mkdir(generatedAst)

      await Expect(runParserGenerate({ generate: langium.generate, repositoryRoot: root }))
        .rejects.toThrow('Parser generation cannot replace a directory with a file')
      Expect(await FS.isDirectory(generatedAst)).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a symbolic link in staged generated output without reading through it', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    const outside = FS.resolvePath('outside-source.ts', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      await FS.writeText(outside, 'outside source bytes\n')

      await Expect(runParserGenerate({
        generate: async parserRoot => {
          const result = await langium.generate(parserRoot)
          const stagingRoot = FS.resolvePath('../../..', parserRoot)
          const stagedAst = FS.resolvePath(
            'packages/language/parser/parser-src/_gen_tao-parser/ast.ts',
            stagingRoot,
          )
          await FS.remove(stagedAst)
          await FS.symlink(outside, stagedAst)
          return result
        },
        repositoryRoot: root,
      })).rejects.toThrow('staged output contains a symbolic link')

      Expect(await FS.readText(outside)).toBe('outside source bytes\n')
      Expect(await FS.readText(generatedAst)).toBe('generated 1\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a symbolic link in the worktree output without writing through it', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    const outside = FS.resolvePath('outside-target.ts', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      await FS.writeText(outside, 'outside target bytes\n')
      await FS.remove(generatedAst)
      await FS.symlink(outside, generatedAst)

      await Expect(runParserGenerate({ generate: langium.generate, repositoryRoot: root }))
        .rejects.toThrow('output contains a symbolic link')
      Expect(await FS.readText(outside)).toBe('outside target bytes\n')
      Expect(await FS.isSymbolicLink(generatedAst)).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rechecks destination links immediately before publication', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    const outside = FS.resolvePath('outside-precommit.ts', root)
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      await FS.writeText(outside, 'outside precommit bytes\n')

      await Expect(runParserGenerate({
        beforePublication: async () => {
          await FS.remove(generatedAst)
          await FS.symlink(outside, generatedAst)
        },
        generate: langium.generate,
        repositoryRoot: root,
      })).rejects.toThrow('output shape changed before publication')

      Expect(await FS.readText(outside)).toBe('outside precommit bytes\n')
      Expect(await FS.isSymbolicLink(generatedAst)).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rechecks live grammar and configuration identity after the final publication hook', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    let mutated = false
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      const astBefore = await FS.readText(generatedAst)
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')

      await Expect(runParserGenerate({
        beforeMove: async () => {
          if (mutated) {
            return
          }
          mutated = true
          await FS.writeText(grammar, 'ViewDeclaration: "changed again";\n')
        },
        generate: langium.generate,
        repositoryRoot: root,
      })).rejects.toThrow('inputs changed before publication')

      Expect(mutated).toBe(true)
      Expect(await FS.readText(generatedAst)).toBe(astBefore)
    } finally {
      await FS.remove(root)
    }
  })

  Test('preserves an external mid-commit write and reports both publication and rollback failures', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    let injected = false
    let thrown: unknown
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      try {
        await runParserGenerate({
          beforeMove: async (_fromPath, toPath) => {
            if (injected || FS.basename(toPath) !== 'grammar.ts') {
              return
            }
            injected = true
            await FS.writeText(generatedAst, 'external concurrent bytes\n')
            Errors.throwUnexpected('primary parser publication failure')
          },
          generate: langium.generate,
          repositoryRoot: root,
        })
      } catch (error) {
        thrown = error
      }

      Expect(Errors.messageOf(thrown)).toBe('primary parser publication failure')
      Expect(Errors.formatForLog(thrown)).toContain('Rollback preserved a concurrent write')
      Expect(await FS.readText(generatedAst)).toBe('external concurrent bytes\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a generated-output parent swap before it can publish outside the repository', async () => {
    const root = await repository()
    const external = await mkTestDir('tao-parser-external-')
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedRoot = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser', root)
    let swapped = false
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      await FS.writeText(FS.resolvePath('sentinel.txt', external), 'outside\n')

      await Expect(runParserGenerate({
        beforeMove: async (_fromPath, toPath) => {
          if (swapped || !FS.pathIsWithin(toPath, generatedRoot)) {
            return
          }
          swapped = true
          await FS.remove(generatedRoot)
          await FS.symlink(external, generatedRoot)
        },
        generate: langium.generate,
        repositoryRoot: root,
      })).rejects.toThrow('move destination symbolic link')

      Expect(await FS.readText(FS.resolvePath('sentinel.txt', external))).toBe('outside\n')
      Expect(await FS.exists(FS.resolvePath('ast.ts', external))).toBe(false)
    } finally {
      await FS.remove(root)
      await FS.remove(external)
    }
  })

  Test('preserves the publication failure when staging cleanup also fails', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    let thrown: unknown
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')
      try {
        await runParserGenerate({
          beforeCleanup: async () => Errors.throwUnexpected('secondary staging cleanup failure'),
          beforeMove: async () => Errors.throwUnexpected('primary publication failure'),
          generate: langium.generate,
          repositoryRoot: root,
        })
      } catch (error) {
        thrown = error
      }

      Expect(Errors.messageOf(thrown)).toBe('primary publication failure')
      Expect(Errors.formatForLog(thrown)).toContain('secondary staging cleanup failure')
    } finally {
      await FS.remove(root)
    }
  })

  Test('restores every original file after an injected mid-publication move failure', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    const generatedGrammar = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/grammar.ts', root)
    let injected = false
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      const astBefore = await FS.readText(generatedAst)
      const grammarBefore = await FS.readText(generatedGrammar)
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')

      await Expect(runParserGenerate({
        beforeMove: async (_fromPath, toPath) => {
          if (!injected && FS.basename(toPath) === 'grammar.ts') {
            injected = true
            Errors.throwUnexpected('injected generated-file move failure')
          }
        },
        generate: langium.generate,
        repositoryRoot: root,
      })).rejects.toThrow('injected generated-file move failure')

      Expect(injected).toBe(true)
      Expect(await FS.readText(generatedAst)).toBe(astBefore)
      Expect(await FS.readText(generatedGrammar)).toBe(grammarBefore)
    } finally {
      await FS.remove(root)
    }
  })

  Test('restores overwritten and stale files after an injected stale-file removal failure', async () => {
    const root = await repository()
    const langium = generator()
    const grammar = FS.resolvePath('packages/language/parser/parser-grammar/views.langium', root)
    const generatedAst = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/ast.ts', root)
    const newlyGenerated = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/new.ts', root)
    const staleFile = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/stale.ts', root)
    let injected = false
    try {
      await runParserGenerate({ generate: langium.generate, repositoryRoot: root })
      const astBefore = await FS.readText(generatedAst)
      await FS.writeText(staleFile, 'original stale bytes\n')
      await FS.writeText(grammar, 'ViewDeclaration: "changed";\n')

      await Expect(runParserGenerate({
        beforeRemove: async path => {
          if (!injected && path === staleFile) {
            injected = true
            Errors.throwUnexpected('injected stale-file removal failure')
          }
        },
        generate: async parserRoot => {
          const result = await langium.generate(parserRoot)
          const stagingRoot = FS.resolvePath('../../..', parserRoot)
          await FS.writeText(
            FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser/new.ts', stagingRoot),
            'new generated bytes\n',
          )
          return result
        },
        repositoryRoot: root,
      })).rejects.toThrow('injected stale-file removal failure')

      Expect(injected).toBe(true)
      Expect(await FS.readText(generatedAst)).toBe(astBefore)
      Expect(await FS.readText(staleFile)).toBe('original stale bytes\n')
      Expect(await FS.exists(newlyGenerated)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('regenerates when the Langium configuration changes even though no grammar file did', async () => {
    const root = await repository()
    const langium = generator()
    const config = FS.resolvePath('packages/language/parser/langium-config.json', root)
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
