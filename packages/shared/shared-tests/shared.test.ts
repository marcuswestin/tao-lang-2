import { AfterEach, Describe, Expect, Test } from '@shared/test'
import {
  Assert,
  CLI,
  type Diagnostic,
  Diagnostics,
  Errors,
  FS,
  HCI,
  Log,
  Repo,
  Switch,
  Text,
} from '../shared-src/shared'
import { PassThrough, runtimeProcess, Writable } from './TestRuntime'

const cleanupPaths: string[] = []

AfterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await FS.remove(path)
  }
})

Describe('FS', () => {
  Test('joins and resolves slash-separated parts as host paths', async () => {
    const root = await tmpDir()
    const val = 'alpha'
    const file = 'screen.tao'
    const relativePath = FS.joinPath(`foo/${val}/cat/wat/mat/${file}`)

    const fullPath = FS.resolvePath(`foo/${val}/cat/wat/mat/${file}`, { cwd: root })

    Expect(FS.resolvePath(relativePath, { cwd: root })).toBe(fullPath)
    Expect(FS.resolvePath(fullPath, { cwd: FS.resolvePath('ignored', { cwd: root }) })).toBe(
      fullPath,
    )
  })

  Test('resolves repo-relative paths from the Git root', async () => {
    const repoRoot = Repo.getRoot()
    const sharedPath = FS.resolvePath(`${repoRoot}/packages/shared`)

    Expect(FS.repoPath('packages/shared')).toBe(sharedPath)
  })

  Test('writes and reads text and json files', async () => {
    const root = await tmpDir()
    const textPath = FS.resolvePath('nested/hello.txt', { cwd: root })
    const jsonPath = FS.resolvePath('nested/data.json', { cwd: root })
    const bytesPath = FS.resolvePath('nested/bytes.txt', { cwd: root })

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
    Expect(await FS.readJson<{ answer: number }>(jsonPath)).toEqual({ answer: 42 })
    Expect(await FS.readText(bytesPath)).toBe('bytes appended')
    Expect(await FS.isFile(textPath)).toBe(true)
    Expect(await FS.isDirectory(FS.dirname(textPath))).toBe(true)
  })

  Test('copies, moves, lists, and removes paths', async () => {
    const root = await tmpDir()
    const sourcePath = FS.resolvePath('source.txt', { cwd: root })
    const copyPath = FS.resolvePath('copies/copy.txt', { cwd: root })
    const movedPath = FS.resolvePath('moved/copy.txt', { cwd: root })

    await FS.writeText(sourcePath, 'copy me')
    await FS.copyFile(sourcePath, copyPath)
    await FS.move(copyPath, movedPath)

    Expect(await FS.readText(movedPath)).toBe('copy me')
    Expect(await FS.exists(copyPath)).toBe(false)
    await FS.writeText(FS.resolvePath('added.txt', { cwd: FS.dirname(movedPath) }), 'added later')
    Expect(await FS.listDir(FS.dirname(movedPath))).toEqual(['added.txt', 'copy.txt'])

    await FS.remove(FS.dirname(movedPath))
    Expect(await FS.exists(movedPath)).toBe(false)
  })

  Test('copies directories and walks files with filters', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('src', { cwd: root })
    const copyDir = FS.resolvePath('copy', { cwd: root })

    await FS.writeText(FS.resolvePath('a.ts', { cwd: sourceDir }), 'a')
    await FS.writeText(FS.resolvePath('b.txt', { cwd: sourceDir }), 'b')
    await FS.writeText(FS.resolvePath('.hidden.ts', { cwd: sourceDir }), 'hidden')
    await FS.writeText(FS.resolvePath('nested/c.ts', { cwd: sourceDir }), 'c')
    await FS.writeText(FS.resolvePath('ignored/d.ts', { cwd: sourceDir }), 'd')
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
      FS.resolvePath('a.ts', { cwd: copyDir }),
      FS.resolvePath('nested/c.ts', { cwd: copyDir }),
    ])
  })

  Test('does not swallow read or list errors', async () => {
    const root = await tmpDir()

    await Expect(FS.readText(FS.resolvePath('missing.txt', { cwd: root }))).rejects.toThrow()
    await Expect(FS.listDir(FS.resolvePath('missing', { cwd: root }))).rejects.toThrow()
  })
})

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

  Test('colors process log message bodies by severity', () => {
    const stdout = runtimeProcess.stdout
    const stderr = runtimeProcess.stderr
    const info = fakeTerminal('')
    const errors = fakeTerminal('')
    runtimeProcess.stdout = info.output as typeof runtimeProcess.stdout
    runtimeProcess.stderr = errors.output as typeof runtimeProcess.stderr

    try {
      HCI.logProcessInfo('dev', 'info body')
      HCI.logProcessWarn('dev', 'warn body')
      HCI.logProcessError('dev', 'error body')

      Expect(stripAnsi(info.outputText())).toBe('[dev]: info body\n')
      Expect(stripAnsi(errors.outputText())).toBe('[dev]: warn body\n[dev]: error body\n')
      Expect(info.outputText()).toContain('\u001b[2minfo body\u001b[0m')
      Expect(errors.outputText()).toContain('\u001b[33mwarn body\u001b[0m')
      Expect(errors.outputText()).toContain('\u001b[31merror body\u001b[0m')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
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
  Test('runs commands and captures output', async () => {
    const root = await tmpDir()
    const result = await CLI.run(runtimeProcess.execPath, {
      args: ['-e', 'console.log(process.cwd()); console.error(process.env.TAO_CLI_TEST)'],
      cwd: root,
      env: { TAO_CLI_TEST: 'ok' },
    })

    Expect(result.exitCode).toBe(0)
    Expect(FS.basename(result.stdout.trim())).toBe(FS.basename(root))
    Expect(result.stderr.trim()).toBe('ok')
  })

  Test('passes stdin to commands', async () => {
    const result = await CLI.run(runtimeProcess.execPath, {
      args: ['-e', 'for await (const chunk of process.stdin) process.stdout.write(chunk.toString().toUpperCase())'],
      stdin: 'abc',
    })

    Expect(result.stdout).toBe('ABC')
  })

  Test('returns unchecked failures and throws checked failures', async () => {
    const commandSpec = {
      args: ['-e', 'console.error("bad"); process.exit(7)'],
    }

    const result = await CLI.run(runtimeProcess.execPath, commandSpec)
    const syncResult = CLI.runSync(runtimeProcess.execPath, commandSpec)

    Expect(result.exitCode).toBe(7)
    Expect(result.stderr.trim()).toBe('bad')
    Expect(syncResult.exitCode).toBe(7)
    Expect(syncResult.stderr.trim()).toBe('bad')
    await Expect(CLI.mustRun(runtimeProcess.execPath, commandSpec)).rejects.toBeInstanceOf(Errors.CommandExecutionError)
    Expect(() => CLI.mustRunSync(runtimeProcess.execPath, commandSpec)).toThrow(Errors.CommandExecutionError)
  })

  Test('formats commands and supports inherited stdio', async () => {
    Expect(CLI.formatCommand('tao', { args: ['run', 'Hello World.tao'] })).toBe('tao run "Hello World.tao"')

    const result = await CLI.run(runtimeProcess.execPath, {
      args: ['-e', 'process.exit(0)'],
      stdio: 'inherit',
    })

    Expect(result.stdout).toBe('')
    Expect(result.stderr).toBe('')
  })

  Test('streams output while preserving captured output', async () => {
    const stdout = runtimeProcess.stdout
    const stderr = runtimeProcess.stderr
    let streamedStdout = ''
    let streamedStderr = ''
    runtimeProcess.stdout = new Writable({
      write(chunk, _encoding, callback) {
        streamedStdout += chunk.toString()
        callback()
      },
    }) as typeof runtimeProcess.stdout
    runtimeProcess.stderr = new Writable({
      write(chunk, _encoding, callback) {
        streamedStderr += chunk.toString()
        callback()
      },
    }) as typeof runtimeProcess.stderr

    try {
      const result = await CLI.run(runtimeProcess.execPath, {
        args: ['-e', 'console.log(`out`); console.error(`err`)'],
        stdio: 'stream',
      })

      Expect(result.stdout.trim()).toBe('out')
      Expect(result.stderr.trim()).toBe('err')
      Expect(streamedStdout.trim()).toBe('out')
      Expect(stripAnsi(streamedStderr).trim()).toBe('err')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
  })

  Test('streams prefixed output while preserving captured output', async () => {
    const stdout = runtimeProcess.stdout
    const stderr = runtimeProcess.stderr
    let streamedStdout = ''
    let streamedStderr = ''
    runtimeProcess.stdout = new Writable({
      write(chunk, _encoding, callback) {
        streamedStdout += chunk.toString()
        callback()
      },
    }) as typeof runtimeProcess.stdout
    runtimeProcess.stderr = new Writable({
      write(chunk, _encoding, callback) {
        streamedStderr += chunk.toString()
        callback()
      },
    }) as typeof runtimeProcess.stderr

    try {
      const result = await CLI.run(runtimeProcess.execPath, {
        args: ['-e', 'console.log(`out`); console.error(`err`)'],
        prefixedOutput: { processName: 'test' },
      })

      Expect(result.stdout.trim()).toBe('out')
      Expect(result.stderr.trim()).toBe('err')
      Expect(streamedStdout).toContain('[test]')
      Expect(streamedStdout).toContain('out')
      Expect(streamedStderr).toContain('[test]')
      Expect(streamedStderr).toContain('err')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
  })

  Test('starts commands and streams prefixed output', async () => {
    const stdout = runtimeProcess.stdout
    let streamedStdout = ''
    runtimeProcess.stdout = new Writable({
      write(chunk, _encoding, callback) {
        streamedStdout += chunk.toString()
        callback()
      },
    }) as typeof runtimeProcess.stdout

    try {
      const command = CLI.start(runtimeProcess.execPath, {
        args: ['-e', 'console.log(`ready`)'],
        prefixedOutput: { processName: 'dev' },
      })
      const close = await command.waitForClose()
      await command.closeOutput()

      Expect(close.exitCode).toBe(0)
      Expect(command.exitCode).toBe(0)
      Expect(streamedStdout).toContain('[dev]')
      Expect(streamedStdout).toContain('ready')
    } finally {
      runtimeProcess.stdout = stdout
    }
  })

  Test('streams stdout and stderr chunks to an onOutput callback', async () => {
    const chunks: { stream: string; text: string }[] = []
    const command = CLI.start(runtimeProcess.execPath, {
      args: ['-e', 'process.stdout.write(`out`); process.stderr.write(`err`)'],
      onOutput: (stream, chunk) => chunks.push({ stream, text: chunk.toString('utf8') }),
      stdio: 'pipe',
    })
    await command.waitForClose()

    Expect(chunks.some(chunk => chunk.stream === 'stdout' && chunk.text.includes('out'))).toBe(true)
    Expect(chunks.some(chunk => chunk.stream === 'stderr' && chunk.text.includes('err'))).toBe(true)
  })
})

Describe('Repo', () => {
  Test('finds the current git worktree root from a nested cwd', async () => {
    const cwd = runtimeProcess.cwd()
    const root = Repo.getRoot()

    try {
      runtimeProcess.chdir(FS.resolvePath('packages/shared', { cwd: root }))
      Expect(Repo.getRoot()).toBe(root)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })

  Test('rejects outside a git worktree', async () => {
    const cwd = runtimeProcess.cwd()
    const outsideRepo = await tmpDir()

    try {
      runtimeProcess.chdir(outsideRepo)
      Expect(() => Repo.getRoot()).toThrow(Errors.CommandExecutionError)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })
})

Describe('Log', () => {
  Test('uses swappable transports', () => {
    const calls: string[] = []

    Log.setTransport({
      debug: message => calls.push(`debug:${message}`),
      info: message => calls.push(`info:${message}`),
      warn: message => calls.push(`warn:${message}`),
      error: (message, ...details) => calls.push(`error:${message}:${details.join(',')}`),
      success: message => calls.push(`success:${message}`),
      user: message => calls.push(`user:${message}`),
    })
    Log.debug('debug')
    Log.info('hello')
    Log.warn('heads up')
    Log.error('failed', new Error('boom'))
    Log.success('done')
    Log.user('shown')
    Log.setTransport({})

    Expect(calls[0]).toBe('debug:debug')
    Expect(calls[1]).toBe('info:hello')
    Expect(calls[2]).toBe('warn:heads up')
    Expect(calls[3]).toContain('error:failed:Error: boom')
    Expect(calls[4]).toBe('success:done')
    Expect(calls[5]).toBe('user:shown')
    Expect('trace' in Log).toBe(false)
    Expect('withTransport' in Log).toBe(false)
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

  Test('asserts conditions and narrows values', () => {
    const value: string | undefined = 'tao'

    Assert(value, 'value exists')
    Assert.defined(value, 'value is defined')
    Assert.is(value, isString, 'value is a string')
    Expect(value.toUpperCase()).toBe('TAO')
    Expect(() => Assert(false, 'truthy')).toThrow(Errors.UnexpectedBehaviorError)
  })

  Test('switches exhaustively by value, type, and property', () => {
    type Item =
      | { $type: 'text'; value: string; state: 'ready' }
      | { $type: 'count'; value: number; state: 'empty' }

    const item: Item = { $type: 'text', value: 'hello', state: 'ready' }

    const selectedValue = Switch.value<'a' | 'b', number>('a', {
      a: () => 1,
      b: () => 2,
    })
    const selectedOptionalValue = Switch.value<'raw' | undefined, string>(undefined, {
      raw: () => 'raw',
      undefined: () => 'normal',
    })
    const selectedType = Switch.type<Item, string>(item, {
      text: text => text.value,
      count: count => count.value.toString(),
    })
    const selectedProperty = Switch.property<Item, 'state', string>(item, 'state', {
      ready: () => 'Ready',
      empty: () => 'Empty',
    })

    Expect(selectedValue).toBe(1)
    Expect(selectedOptionalValue).toBe('normal')
    Expect(selectedType).toBe('hello')
    Expect(selectedProperty).toBe('Ready')
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
})

async function tmpDir() {
  const dir = await FS.mkTmpDir(FS.resolvePath('tao-shared-test-', { cwd: FS.tmpdir() }))
  cleanupPaths.push(dir)
  return dir
}

function fakeTerminal(inputText: string) {
  const outputChunks: Buffer[] = []
  const responses = inputText.match(/[^\n]*\n/g) ?? []
  const input = new PassThrough()
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputChunks.push(Buffer.from(chunk))
      if (chunk.toString().endsWith(': ')) {
        const response = responses.shift()
        if (response !== undefined) {
          input.write(response)
        }
      }
      callback()
    },
  })

  return {
    input,
    output,
    interactive: true,
    outputText: () => Buffer.concat(outputChunks).toString('utf8'),
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]+m/g, '')
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
