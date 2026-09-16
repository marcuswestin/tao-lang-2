import { Switch as CoreSwitch } from '@shared/core'
import { AfterEach, Describe, Expect, fakeTerminal, mkTestDir, settle, Test, withCapturedOutput } from '@shared/test'
import { PassThrough } from 'node:stream'
import {
  Assert,
  CLI,
  type Diagnostic,
  Diagnostics,
  Errors,
  FS,
  HCI,
  Repo,
  Switch,
  Text,
} from '../shared-src/shared'

const cleanupPaths: string[] = []

AfterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await FS.remove(path)
  }
})

Describe('FS', () => {
  Test('resolves repo-relative paths from the Git root', async () => {
    const repoRoot = Repo.resolvePath()
    const sharedPath = FS.resolvePath(`${repoRoot}/packages/shared`)

    Expect(Repo.resolvePath('packages/shared')).toBe(sharedPath)
  })

  Test('writes and reads text and json files', async () => {
    const root = await tmpDir()
    const textPath = FS.resolvePath('nested/hello.txt', root)
    const jsonPath = FS.resolvePath('nested/data.json', root)
    const bytesPath = FS.resolvePath('nested/bytes.txt', root)

    await FS.writeText(textPath, 'hello')
    await FS.writeJson(jsonPath, { answer: 42 })
    await FS.writeFile(bytesPath, Buffer.from('bytes'))
    const appendHandle = await FS.openAppend(bytesPath)
    try {
      await appendHandle.writeFile(' appended')
    } finally {
      await appendHandle.close()
    }

    Expect(await FS.readText(textPath)).toBe('hello')
    Expect(FS.readTextSync(textPath)).toBe('hello')
    Expect(await FS.readJson<{ answer: number }>(jsonPath)).toEqual({ answer: 42 })
    Expect(await FS.readText(bytesPath)).toBe('bytes appended')
    Expect(await FS.isFile(textPath)).toBe(true)
    Expect(await FS.isDirectory(FS.dirname(textPath))).toBe(true)
  })

  Test('copies, moves, lists, and removes paths', async () => {
    const root = await tmpDir()
    const sourcePath = FS.resolvePath('source.txt', root)
    const copyPath = FS.resolvePath('copies/copy.txt', root)
    const movedPath = FS.resolvePath('moved/copy.txt', root)

    await FS.writeText(sourcePath, 'copy me')
    await FS.copyFile(sourcePath, copyPath)
    await FS.move(copyPath, movedPath)

    Expect(await FS.readText(movedPath)).toBe('copy me')
    Expect(await FS.exists(copyPath)).toBe(false)
    await FS.writeText(FS.resolvePath('added.txt', FS.dirname(movedPath)), 'added later')
    Expect(await FS.listDir(FS.dirname(movedPath))).toEqual(['added.txt', 'copy.txt'])

    await FS.remove(FS.dirname(movedPath))
    Expect(await FS.exists(movedPath)).toBe(false)
  })

  Test('copies directories and walks files with filters', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('src', root)
    const copyDir = FS.resolvePath('copy', root)

    await FS.writeText(FS.resolvePath('a.ts', sourceDir), 'a')
    await FS.writeText(FS.resolvePath('b.txt', sourceDir), 'b')
    await FS.writeText(FS.resolvePath('.hidden.ts', sourceDir), 'hidden')
    await FS.writeText(FS.resolvePath('nested/c.ts', sourceDir), 'c')
    await FS.writeText(FS.resolvePath('ignored/d.ts', sourceDir), 'd')
    await FS.copyDirectory(sourceDir, copyDir)

    const walked: string[] = []
    for await (
      const path of FS.walk(copyDir, {
        extensions: ['.ts'],
        excludeDirectory: name => name === 'ignored',
      })
    ) {
      walked.push(path)
    }

    Expect(walked.sort()).toEqual([
      FS.resolvePath('a.ts', copyDir),
      FS.resolvePath('nested/c.ts', copyDir),
    ])
  })

  Test('walk follows symlinked directories only when requested', async () => {
    const root = await tmpDir()
    const externalDir = await tmpDir()
    const linkPath = FS.resolvePath('linked', root)

    await FS.writeText(FS.resolvePath('local.ts', root), 'local')
    await FS.writeText(FS.resolvePath('external.ts', externalDir), 'external')
    await FS.symlink(externalDir, linkPath)

    const defaultWalked = await walkRelative(root)
    const symlinkWalked = await walkRelative(root, { followSymlinks: true })

    Expect(defaultWalked).toEqual(['local.ts'])
    Expect(symlinkWalked).toEqual(['linked/external.ts', 'local.ts'])
  })

  Test('walk prevents cycles while following symlinked directories', async () => {
    const root = await tmpDir()
    const childDir = FS.resolvePath('child', root)

    await FS.writeText(FS.resolvePath('child/file.ts', root), 'child')
    await FS.symlink(root, FS.resolvePath('loop', childDir))

    const walked = await walkRelative(root, { followSymlinks: true })

    Expect(walked).toEqual(['child/file.ts'])
  })

  Test('resolves real paths synchronously with the async contract', async () => {
    const root = await tmpDir()
    const physicalPath = FS.resolvePath('physical/file.txt', root)
    const linkedPath = FS.resolvePath('linked-file.txt', root)
    const missingPath = FS.resolvePath('missing.txt', root)
    await FS.writeText(physicalPath, 'content')
    await FS.symlink(physicalPath, linkedPath)

    Expect(FS.realPathSync(linkedPath)).toBe(await FS.realPath(linkedPath))
    Expect(() => FS.realPathSync(missingPath)).toThrow()
    await Expect(FS.realPath(missingPath)).rejects.toThrow()
  })

  Test('does not swallow read or list errors', async () => {
    const root = await tmpDir()

    await Expect(FS.readText(FS.resolvePath('missing.txt', root))).rejects.toThrow()
    await Expect(FS.listDir(FS.resolvePath('missing', root))).rejects.toThrow()
  })
})

async function walkRelative(root: string, options: FS.WalkOptions = {}): Promise<string[]> {
  const walked: string[] = []
  for await (const path of FS.walk(root, { extensions: ['.ts'], ...options })) {
    walked.push(FS.relativePath(root, path))
  }
  return walked.sort()
}

Describe('HCI', () => {
  Test('writes messages to selected output streams', () => {
    const stdout = fakeTerminal('')
    const stderr = fakeTerminal('')

    HCI.write('out', { output: stdout.output })
    HCI.writeLine(' line', { output: stdout.output })
    HCI.writeError('err', { output: stderr.output })
    HCI.writeErrorLine(' line', { output: stderr.output })
    HCI.writeSuccess(' success', { output: stdout.output })

    Expect(stripAnsi(stdout.outputText())).toBe('out line\n success')
    Expect(stripAnsi(stderr.outputText())).toBe('err line\n')
    Expect(stdout.outputText()).toContain('\u001b[32m')
    Expect(stderr.outputText()).toContain('\u001b[31m')
  })

  Test('colors process log message bodies by severity', async () => {
    const logged = await withCapturedOutput(() => {
      HCI.logProcessInfo('dev', 'info body')
      HCI.logProcessWarn('dev', 'warn body')
      HCI.logProcessError('dev', 'error body')
    })

    Expect(stripAnsi(logged.stdout)).toBe('[dev]: info body\n')
    Expect(stripAnsi(logged.stderr)).toBe('[dev]: warn body\n[dev]: error body\n')
    Expect(logged.stdout).toContain('\u001b[2minfo body\u001b[0m')
    Expect(logged.stderr).toContain('\u001b[33mwarn body\u001b[0m')
    Expect(logged.stderr).toContain('\u001b[31merror body\u001b[0m')
  })

  Test('asks for text with validation', async () => {
    const streams = fakeTerminal(' \nRo\n')

    const value = await HCI.askText({
      message: 'Name',
      validate: value => value.trim() === '' ? 'Required' : undefined,
      ...streams,
    })

    Expect(value).toBe('Ro')
    Expect(streams.outputText()).toContain('Required')
  })

  Test('asks for confirmations and choices', async () => {
    const confirm = await HCI.askConfirm({ message: 'Continue', ...fakeTerminal('\n'), defaultValue: true })
    const choice = await HCI.askChoice({
      message: 'Pick',
      choices: [
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
      ],
      ...fakeTerminal('2\n'),
    })

    Expect(confirm).toBe(true)
    Expect(choice).toBe('two')
  })

  Test('renders the confirmation hint from the shared suffix in the asked question', async () => {
    const streams = fakeTerminal('\n')

    await HCI.askConfirm({ message: 'Kill it?', ...streams, defaultValue: false })

    Expect(HCI.confirmChoiceSuffix(false)).toBe(' [y/N]')
    Expect(HCI.confirmChoiceSuffix(true)).toBe(' [Y/n]')
    Expect(HCI.confirmChoiceSuffix(undefined)).toBe(' [y/n]')
    Expect(stripAnsi(streams.outputText())).toContain(`Kill it?${HCI.confirmChoiceSuffix(false)}`)
  })

  Test('reads raw keys one at a time from any terminal stream, without waiting for Enter', async () => {
    const terminal = fakeTerminal()
    terminal.input.write('1a')
    let rawModeWhileReading = false

    const keys = await HCI.withRawKeys(async readKey => {
      rawModeWhileReading = terminal.rawMode()
      return [await readKey(), await readKey()]
    }, terminal)

    Expect(keys).toEqual(['1', 'a'])
    Expect(rawModeWhileReading).toBe(true)
    Expect(terminal.rawMode()).toBe(false)
    // A still-flowing input keeps the process alive, so a finished session must release the stream.
    Expect(terminal.input.isPaused()).toBe(true)
  })

  Test('reads an escape sequence as one Escape and a closed input as an interrupt', async () => {
    const terminal = fakeTerminal()

    const keys = await HCI.withRawKeys(async readKey => {
      terminal.input.write(`${HCI.RawKey.escape}[A`)
      const arrowKey = await readKey()
      terminal.input.end()
      return [arrowKey, await readKey()]
    }, terminal)

    Expect(keys).toEqual([HCI.RawKey.escape, HCI.RawKey.interrupt])
  })

  Test('reports every key of a chunk to a raw-key listener until the session is stopped', async () => {
    const terminal = fakeTerminal()
    const keys: string[] = []
    const session = HCI.startRawKeys(key => keys.push(key), terminal)

    terminal.input.write('qr')
    await settle()
    session.stop()
    terminal.input.write('x')
    await settle()

    Expect(session.rawMode).toBe(true)
    Expect(keys).toEqual(['q', 'r'])
    Expect(terminal.rawMode()).toBe(false)
    Expect(terminal.input.isPaused()).toBe(true)
  })

  Test('reports no raw mode for input that is not an interactive terminal', async () => {
    const plainInput = new PassThrough()

    const session = HCI.startRawKeys(() => undefined, { input: plainInput })
    session.stop()

    Expect(session.rawMode).toBe(false)
  })

  Test('uses defaults or rejects in non-interactive mode', async () => {
    await Expect(HCI.askText({ message: 'Name', interactive: false, defaultValue: 'Ro' })).resolves.toBe('Ro')
    await Expect(HCI.askConfirm({ message: 'Continue', interactive: false, defaultValue: false })).resolves.toBe(false)
    await Expect(
      HCI.askChoice({
        message: 'Pick',
        choices: [{ value: 'one' }],
        interactive: false,
        defaultValue: 'one',
      }),
    ).resolves.toBe('one')
    await Expect(HCI.askText({ message: 'Name', interactive: false })).rejects.toBeInstanceOf(Errors.UserInputError)
  })
})

Describe('Diagnostics', () => {
  Test('filters and checks diagnostics by source, severity, and message', () => {
    const diagnostics: Diagnostic[] = [
      { message: 'bad token', severity: 'error', source: 'lexer' },
      { message: 'missing view', severity: 'error', source: 'linker' },
      { message: 'duplicate name', severity: 'warning', source: 'validator' },
    ]

    Expect(Diagnostics.messages(diagnostics, 'linker')).toEqual(['missing view'])
    Expect(Diagnostics.messages(diagnostics, 'lexer', 'parser')).toEqual(['bad token'])
    Expect(Diagnostics.hasError(diagnostics, 'lexer', 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(diagnostics, 'compiler')).toBe(false)
    Expect(Diagnostics.allFromSource(diagnostics, 'lexer', 'linker', 'validator')).toBe(true)
    Expect(Diagnostics.allWithSeverity(diagnostics, 'error', 'lexer', 'linker')).toBe(true)
    Expect(Diagnostics.hasMessageContaining(diagnostics, 'missing', 'linker')).toBe(true)
    Expect(Diagnostics.allMessagesContain(diagnostics, 'view', 'linker')).toBe(true)
  })

  Test('keeps diagnostics from different files distinct', () => {
    const diagnostics: Diagnostic[] = [
      { filePath: '/project/A.tao', message: 'Expected }', severity: 'error', source: 'parser' },
      { filePath: '/project/B.tao', message: 'Expected }', severity: 'error', source: 'parser' },
      { filePath: '/project/B.tao', message: 'Expected }', severity: 'error', source: 'parser' },
      {
        filePath: '/project/B.tao',
        message: 'Expected }',
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 2 },
        },
        severity: 'error',
        source: 'parser',
      },
      {
        filePath: '/project/B.tao',
        message: 'Expected }',
        nodeType: 'View',
        severity: 'error',
        source: 'parser',
      },
    ]

    Expect(Diagnostics.unique(diagnostics)).toHaveLength(4)
  })
})

Describe('CLI', () => {
  Test('returns unchecked failures and throws checked failures', async () => {
    const commandSpec = {
      args: ['-c', 'printf bad >&2; exit 7'],
    }

    const result = await CLI.run('/bin/sh', commandSpec)

    Expect(result.exitCode).toBe(7)
    await Expect(CLI.mustRun('/bin/sh', commandSpec)).rejects.toBeInstanceOf(Errors.CommandExecutionError)
    Expect(() => CLI.mustRunSync('/bin/sh', commandSpec)).toThrow(Errors.CommandExecutionError)
  })

  Test('captures output from a synchronous command', () => {
    Expect(CLI.mustRunSync('/bin/sh', { args: ['-c', 'printf out'] }).stdout).toBe('out')
  })

  Test('streams output while preserving captured output', async () => {
    const streamed = await withCapturedOutput(() =>
      CLI.run('/bin/sh', {
        args: ['-c', 'printf out; printf err >&2'],
        stdio: 'stream',
      })
    )

    Expect(streamed.result.stdout).toBe('out')
    Expect(streamed.result.stderr).toBe('err')
    Expect(streamed.stdout).toBe('out')
    Expect(stripAnsi(streamed.stderr)).toBe('err')
  })

  Test('streams prefixed output while preserving captured output', async () => {
    const streamed = await withCapturedOutput(() =>
      CLI.run('/bin/sh', {
        args: ['-c', 'printf "out\\ntail"; printf "bad\\n" >&2'],
        prefixedOutput: { processName: 'test' },
      })
    )

    Expect(streamed.result.stdout).toBe('out\ntail')
    Expect(streamed.result.stderr).toBe('bad\n')
    Expect(stripAnsi(streamed.stdout)).toBe('[test]: out\n[test]: tail\n')
    Expect(stripAnsi(streamed.stderr)).toBe('[test]: bad\n')
  })

  Test('captures prefixed process output without writing it to the terminal', async () => {
    const streamed = await withCapturedOutput(() =>
      CLI.run('/bin/sh', {
        args: ['-c', 'printf "out\\n"; printf "bad\\n" >&2'],
        prefixedOutput: { processName: 'test', terminal: false },
      })
    )

    Expect(streamed.result.stdout).toBe('out\n')
    Expect(streamed.result.stderr).toBe('bad\n')
    Expect(streamed.stdout).toBe('')
    Expect(streamed.stderr).toBe('')
  })

  Test('streams stdout and stderr chunks to an onOutput callback', async () => {
    const output = { stderr: '', stdout: '' }
    const command = CLI.start('/bin/sh', {
      args: ['-c', 'printf out; printf err >&2'],
      onOutput: (stream, chunk) => output[stream] += chunk.toString('utf8'),
      stdio: 'pipe',
    })
    const close = await command.waitForClose()

    Expect(close.exitCode).toBe(0)
    Expect(command.exitCode).toBe(0)
    Expect(output).toEqual({ stderr: 'err', stdout: 'out' })
  })
})

Describe('Repo', () => {
  Test('finds the current git worktree root from a nested cwd', async () => {
    const root = Repo.getRoot()

    Expect(Repo.getRoot(FS.resolvePath('packages/shared', root))).toBe(root)
  })

  Test('rejects outside a git worktree', async () => {
    const outsideRepo = await tmpDir()

    Expect(() => Repo.getRoot(outsideRepo)).toThrow(Errors.CommandExecutionError)
  })

  Test('reports no root outside a git worktree instead of throwing', async () => {
    const outsideRepo = await tmpDir()

    Expect(Repo.tryGetRoot(outsideRepo)).toBeUndefined()
    Expect(Repo.tryResolvePath('.devenv/profile/bin/node', outsideRepo)).toBeUndefined()
  })

  Test('resolves repository-relative paths inside a git worktree', async () => {
    const root = Repo.getRoot()

    Expect(Repo.tryGetRoot(root)).toBe(root)
    Expect(Repo.tryResolvePath('packages/shared', root)).toBe(FS.resolvePath('packages/shared', root))
  })

  Test('walks files outside a git worktree without applying loose gitignore files', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('.gitignore', root), '_gen_*\nignored/\n')
      await FS.writeText(FS.resolvePath('a.ts', root), 'a')
      await FS.writeText(FS.resolvePath('nested/b.ts', root), 'b')
      await FS.writeText(FS.resolvePath('_gen_tao-app/c.ts', root), 'c')
      await FS.writeText(FS.resolvePath('ignored/d.ts', root), 'd')
      await FS.writeText(FS.resolvePath('node_modules/package/e.ts', root), 'e')
      await FS.writeText(FS.resolvePath('android/f.ts', root), 'f')

      const files = (await Repo.filesUnder(root, { extensions: ['.ts'] }))
        .map(path => FS.relativePath(root, path))

      Expect(files).toEqual([
        '_gen_tao-app/c.ts',
        'a.ts',
        'android/f.ts',
        'ignored/d.ts',
        'nested/b.ts',
        'node_modules/package/e.ts',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('applies caller-provided directory exclusions while walking outside a git worktree', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('a.ts', root), 'a')
      await FS.writeText(FS.resolvePath('node_modules/package/b.ts', root), 'b')

      const files = (await Repo.filesUnder(root, {
        excludeDirectoryNames: ['node_modules'],
        extensions: ['.ts'],
      })).map(path => FS.relativePath(root, path))

      Expect(files).toEqual(['a.ts'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('omits files below hidden directory segments', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('MVP-4/valid.tao', root), '')
      await FS.writeText(FS.resolvePath('Apps/WordFlower/.tao-archive/ignored.tao', root), '')

      const files = (await Repo.filesUnder(root, {
        extensions: ['.tao'],
      })).map(path => FS.relativePath(root, path))

      Expect(files).toEqual(['MVP-4/valid.tao'])
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('Errors, Assert, and Switch', () => {
  Test('formats Tao errors for users and logs', () => {
    const userError = new Errors.UserInputError('No file selected')
    const unexpected = Errors.fromUnknown('surprise', { while: 'testing' })

    Expect(Errors.isTaoError(userError)).toBe(true)
    Expect(Errors.formatForUser(userError)).toBe('No file selected')
    Expect(Errors.formatForLog(unexpected)).toContain('UnexpectedBehaviorError')
    Expect(Errors.formatForLog(unexpected)).toContain('surprise')
  })

  Test('quotes the command words a reader could not paste back', () => {
    const commandError = new Errors.CommandExecutionError({
      command: 'tao',
      args: ['run', 'Hello World.tao'],
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: '',
    })

    Expect(commandError.messageForUser).toBe('Command failed: tao run "Hello World.tao"')
  })

  Test('sorts a host or environment failure into its own category', () => {
    const hostError = Errors.fromUnknown(
      new Errors.HostEnvironmentError('The Tao Studio browser bundle is missing.', { cause: 'no bundle' }),
    )

    Expect(Errors.isTaoError(hostError)).toBe(true)
    Expect(Errors.formatForUser(hostError)).toBe('The Tao Studio browser bundle is missing.')
    Expect(Errors.formatForLog(hostError)).toContain('HostEnvironmentError')
    Expect(() => Errors.throwHostEnvironment('knip produced no JSON report to read.'))
      .toThrow(Errors.HostEnvironmentError)
  })

  Test('asserts conditions and narrows values', () => {
    const value: string | undefined = 'tao'

    Assert(value, 'value exists')
    Assert.defined(value, 'value defined')
    Assert.is(value, isString, 'value is a string')
    Expect(value.toUpperCase()).toBe('TAO')
    Expect(() => Assert(false, 'truthy')).toThrow(Errors.UnexpectedBehaviorError)
  })

  Test('blames the author for a failed input assertion and keeps their sentence', () => {
    const iterations: number | undefined = 4
    const rejectEmptySamples = (): void => {
      Assert.input(0, 'Performance samples must not be empty.')
    }

    Assert.input(iterations, 'Performance iterations must be a positive integer.')
    Expect(iterations.toFixed(0)).toBe('4')
    Expect(rejectEmptySamples).toThrow(Errors.UserInputError)
    Expect(rejectEmptySamples).toThrow('Performance samples must not be empty.')
  })

  Test('switches exhaustively by value, type, kind, and property', () => {
    type Item =
      | { $type: 'text'; value: string; state: 'ready' }
      | { $type: 'count'; value: number; state: 'empty' }

    type Status =
      | { kind: 'ready'; value: string }
      | { kind: 'empty'; value: number }

    const item: Item = { $type: 'text', value: 'hello', state: 'ready' }
    const status: Status = { kind: 'ready', value: 'hello' }

    const selectedValue = Switch<'a' | 'b', number>('a', {
      a: () => 1,
      b: () => 2,
    })
    const selectedCallableValue = Switch<'a' | 'b', number>('b', {
      a: () => 1,
      b: () => 2,
    })
    const selectedOptionalValue = Switch<'raw' | undefined, string>(undefined, {
      raw: () => 'raw',
      undefined: () => 'normal',
    })
    const selectedType = Switch.type<Item, string>(item, {
      text: text => text.value,
      count: count => count.value.toString(),
    })
    const selectedOptionalType = Switch.typeMaybe<Item | undefined, string>(undefined, {
      text: (text): string => text.value,
      count: count => count.value.toString(),
      undefined: () => 'missing',
    })
    const selectedKind = Switch.kind<Status, string>(status, {
      ready: ready => ready.value,
      empty: empty => empty.value.toString(),
    })
    const selectedOptionalKind = Switch.kindMaybe<Status | undefined, string>(undefined, {
      ready: ready => ready.value,
      empty: empty => empty.value.toString(),
      undefined: () => 'missing',
    })
    const selectedProperty = Switch.property<Item, 'state', string>(item, 'state', {
      ready: () => 'Ready',
      empty: () => 'Empty',
    })

    Expect(selectedValue).toBe(1)
    Expect(selectedCallableValue).toBe(2)
    Expect(selectedOptionalValue).toBe('normal')
    Expect(selectedType).toBe('hello')
    Expect(selectedOptionalType).toBe('missing')
    Expect(selectedKind).toBe('hello')
    Expect(selectedOptionalKind).toBe('missing')
    Expect(selectedProperty).toBe('Ready')
  })

  Test('exports Switch through the environment-safe core entrypoint', () => {
    Expect(CoreSwitch<'a' | 'b', number>('b', {
      a: () => 1,
      b: () => 2,
    })).toBe(2)
    Expect(CoreSwitch).toBe(Switch)
  })
})

Describe('Text', () => {
  Test('strips shared indentation from multiline strings', () => {
    Expect(Text.stripIndent(`
      first
        second
      third
    `)).toBe('first\n  second\nthird')
  })

  Test('preserves relative indentation and blank interior lines', () => {
    Expect(Text.stripIndent(`
        first

          second
    `)).toBe('first\n\n  second')
  })

  Test('indents selected lines', () => {
    Expect(Text.indentLines('first\n\nsecond', 2)).toBe('  first\n  \n  second')
    Expect(Text.indentLines('first\n\nsecond', 2, { skipBlankLines: true, skipFirstLine: true })).toBe(
      'first\n\n  second',
    )
  })

  Test('escapes regexp metacharacters', () => {
    const literal = 'a+b?.[x]'
    Expect(new RegExp(Text.escapeRegExp(literal)).test(literal)).toBe(true)
  })

  Test('stripJsonc drops comments and trailing commas but leaves string contents alone', () => {
    const source = '{\n  // note\n  "s": "x, } /* not a comment */",\n  "list": [1, 2, /* two */],\n}\n'
    Expect(JSON.parse(Text.stripJsonc(source))).toEqual({ list: [1, 2], s: 'x, } /* not a comment */' })
  })
})

async function tmpDir() {
  const dir = await mkTestDir('tao-shared-test-')
  cleanupPaths.push(dir)
  return dir
}

async function untrackedTmpDir() {
  return await mkTestDir('tao-shared-test-')
}

const stripAnsi = Text.stripAnsi

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
