import { Assert, CLI, Errors, FS, HCI, Log, Repo, Switch, Text } from '../shared-src/shared'
import { afterEach, describe, expect, PassThrough, runtimeProcess, test, Writable } from './TestRuntime'

const cleanupPaths: string[] = []

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await FS.remove(path)
  }
})

describe('FS', () => {
  test('joins and resolves slash-separated parts as host paths', async () => {
    const root = await tmpDir()
    const val = 'alpha'
    const file = 'screen.tao'
    const relativePath = FS.joinPath(`foo/${val}/cat/wat/mat/${file}`)

    const fullPath = FS.resolvePath(`foo/${val}/cat/wat/mat/${file}`, { cwd: root })

    expect(FS.resolvePath(relativePath, { cwd: root })).toBe(fullPath)
    expect(FS.resolvePath(fullPath, { cwd: FS.resolvePath('ignored', { cwd: root }) })).toBe(
      fullPath,
    )
  })

  test('resolves repo-relative paths from the Git root', async () => {
    const repoRoot = Repo.getRoot()
    const sharedPath = FS.resolvePath(`${repoRoot}/packages/shared`)

    expect(FS.repoPath('packages/shared')).toBe(sharedPath)
  })

  test('writes and reads text and json files', async () => {
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

    expect(await FS.readText(textPath)).toBe('hello')
    expect(await FS.readJson<{ answer: number }>(jsonPath)).toEqual({ answer: 42 })
    expect(await FS.readText(bytesPath)).toBe('bytes appended')
    expect(await FS.isFile(textPath)).toBe(true)
    expect(await FS.isDirectory(FS.dirname(textPath))).toBe(true)
  })

  test('copies, moves, lists, and removes paths', async () => {
    const root = await tmpDir()
    const sourcePath = FS.resolvePath('source.txt', { cwd: root })
    const copyPath = FS.resolvePath('copies/copy.txt', { cwd: root })
    const movedPath = FS.resolvePath('moved/copy.txt', { cwd: root })

    await FS.writeText(sourcePath, 'copy me')
    await FS.copyFile(sourcePath, copyPath)
    await FS.move(copyPath, movedPath)

    expect(await FS.readText(movedPath)).toBe('copy me')
    expect(await FS.exists(copyPath)).toBe(false)
    expect(await FS.listDir(FS.dirname(movedPath))).toEqual(['copy.txt'])

    await FS.remove(FS.dirname(movedPath))
    expect(await FS.exists(movedPath)).toBe(false)
  })

  test('copies directories and walks files with filters', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('src', { cwd: root })
    const copyDir = FS.resolvePath('copy', { cwd: root })

    await FS.writeText(FS.resolvePath('a.ts', { cwd: sourceDir }), 'a')
    await FS.writeText(FS.resolvePath('b.txt', { cwd: sourceDir }), 'b')
    await FS.writeText(FS.resolvePath('.hidden.ts', { cwd: sourceDir }), 'hidden')
    await FS.writeText(FS.resolvePath('nested/c.ts', { cwd: sourceDir }), 'c')
    await FS.copyDirectory(sourceDir, copyDir)

    const walked: string[] = []
    for await (const path of FS.walk(copyDir, { extensions: ['.ts'] })) {
      walked.push(path)
    }

    expect(walked.sort()).toEqual([
      FS.resolvePath('a.ts', { cwd: copyDir }),
      FS.resolvePath('nested/c.ts', { cwd: copyDir }),
    ])
  })

  test('does not swallow read or list errors', async () => {
    const root = await tmpDir()

    await expect(FS.readText(FS.resolvePath('missing.txt', { cwd: root }))).rejects.toThrow()
    await expect(FS.listDir(FS.resolvePath('missing', { cwd: root }))).rejects.toThrow()
  })
})

describe('HCI', () => {
  test('writes messages to selected output streams', () => {
    const stdout = fakeTerminal('')
    const stderr = fakeTerminal('')

    HCI.write('out', { output: stdout.output })
    HCI.writeLine(' line', { output: stdout.output })
    HCI.writeError('err', { output: stderr.output })
    HCI.writeErrorLine(' line', { output: stderr.output })
    HCI.writeSuccess(' success', { output: stdout.output })

    expect(stripAnsi(stdout.outputText())).toBe('out line\n success')
    expect(stripAnsi(stderr.outputText())).toBe('err line\n')
    expect(stdout.outputText()).toContain('\u001b[32m')
    expect(stderr.outputText()).toContain('\u001b[31m')
  })

  test('colors process log message bodies by severity', () => {
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

      expect(stripAnsi(info.outputText())).toBe('[dev]: info body\n')
      expect(stripAnsi(errors.outputText())).toBe('[dev]: warn body\n[dev]: error body\n')
      expect(info.outputText()).toContain('\u001b[2minfo body\u001b[0m')
      expect(errors.outputText()).toContain('\u001b[33mwarn body\u001b[0m')
      expect(errors.outputText()).toContain('\u001b[31merror body\u001b[0m')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
  })

  test('asks for text with validation', async () => {
    const streams = fakeTerminal(' \nRo\n')

    const value = await HCI.askText({
      message: 'Name',
      validate: value => value.trim() === '' ? 'Required' : undefined,
      ...streams,
    })

    expect(value).toBe('Ro')
    expect(streams.outputText()).toContain('Required')
  })

  test('asks for confirmations and choices', async () => {
    const confirm = await HCI.askConfirm({ message: 'Continue', ...fakeTerminal('\n'), defaultValue: true })
    const choice = await HCI.askChoice({
      message: 'Pick',
      choices: [
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
      ],
      ...fakeTerminal('2\n'),
    })

    expect(confirm).toBe(true)
    expect(choice).toBe('two')
  })

  test('uses defaults or rejects in non-interactive mode', async () => {
    await expect(HCI.askText({ message: 'Name', interactive: false, defaultValue: 'Ro' })).resolves.toBe('Ro')
    await expect(HCI.askConfirm({ message: 'Continue', interactive: false, defaultValue: false })).resolves.toBe(false)
    await expect(
      HCI.askChoice({
        message: 'Pick',
        choices: [{ value: 'one' }],
        interactive: false,
        defaultValue: 'one',
      }),
    ).resolves.toBe('one')
    await expect(HCI.askText({ message: 'Name', interactive: false })).rejects.toBeInstanceOf(Errors.UserInputError)
  })
})

describe('CLI', () => {
  test('runs commands and captures output', async () => {
    const root = await tmpDir()
    const result = await CLI.run(runtimeProcess.execPath, {
      args: ['-e', 'console.log(process.cwd()); console.error(process.env.TAO_CLI_TEST)'],
      cwd: root,
      env: { TAO_CLI_TEST: 'ok' },
    })

    expect(result.exitCode).toBe(0)
    expect(FS.basename(result.stdout.trim())).toBe(FS.basename(root))
    expect(result.stderr.trim()).toBe('ok')
  })

  test('passes stdin to commands', async () => {
    const result = await CLI.run(runtimeProcess.execPath, {
      args: ['-e', 'for await (const chunk of process.stdin) process.stdout.write(chunk.toString().toUpperCase())'],
      stdin: 'abc',
    })

    expect(result.stdout).toBe('ABC')
  })

  test('returns unchecked failures and throws checked failures', async () => {
    const commandSpec = {
      args: ['-e', 'console.error("bad"); process.exit(7)'],
    }

    const result = await CLI.run(runtimeProcess.execPath, commandSpec)
    const syncResult = CLI.runSync(runtimeProcess.execPath, commandSpec)

    expect(result.exitCode).toBe(7)
    expect(result.stderr.trim()).toBe('bad')
    expect(syncResult.exitCode).toBe(7)
    expect(syncResult.stderr.trim()).toBe('bad')
    await expect(CLI.mustRun(runtimeProcess.execPath, commandSpec)).rejects.toBeInstanceOf(Errors.CommandExecutionError)
    expect(() => CLI.mustRunSync(runtimeProcess.execPath, commandSpec)).toThrow(Errors.CommandExecutionError)
  })

  test('formats commands and supports inherited stdio', async () => {
    expect(CLI.formatCommand('tao', { args: ['run', 'Hello World.tao'] })).toBe('tao run "Hello World.tao"')

    const result = await CLI.run(runtimeProcess.execPath, {
      args: ['-e', 'process.exit(0)'],
      stdio: 'inherit',
    })

    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test('streams output while preserving captured output', async () => {
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

      expect(result.stdout.trim()).toBe('out')
      expect(result.stderr.trim()).toBe('err')
      expect(streamedStdout.trim()).toBe('out')
      expect(stripAnsi(streamedStderr).trim()).toBe('err')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
  })

  test('streams prefixed output while preserving captured output', async () => {
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

      expect(result.stdout.trim()).toBe('out')
      expect(result.stderr.trim()).toBe('err')
      expect(streamedStdout).toContain('[test]')
      expect(streamedStdout).toContain('out')
      expect(streamedStderr).toContain('[test]')
      expect(streamedStderr).toContain('err')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
  })

  test('starts commands and streams prefixed output', async () => {
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

      expect(close.exitCode).toBe(0)
      expect(command.exitCode).toBe(0)
      expect(streamedStdout).toContain('[dev]')
      expect(streamedStdout).toContain('ready')
    } finally {
      runtimeProcess.stdout = stdout
    }
  })
})

describe('Repo', () => {
  test('finds the current git worktree root from a nested cwd', async () => {
    const cwd = runtimeProcess.cwd()
    const root = Repo.getRoot()

    try {
      runtimeProcess.chdir(FS.resolvePath('packages/shared', { cwd: root }))
      expect(Repo.getRoot()).toBe(root)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })

  test('finds a nested git repo root without using an outer root', async () => {
    const cwd = runtimeProcess.cwd()
    const outerRoot = await tmpDir()
    const taoRoot = FS.resolvePath('workspace/tao', { cwd: outerRoot })
    const nestedDir = FS.resolvePath('packages/shared', { cwd: taoRoot })

    await FS.mkdir(nestedDir)
    await CLI.mustRun('git', { args: ['init'], cwd: taoRoot })
    const expectedRoot = Repo.getRoot(taoRoot)

    try {
      runtimeProcess.chdir(nestedDir)
      expect(Repo.getRoot()).toBe(expectedRoot)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })

  test('rejects outside a git worktree', async () => {
    const cwd = runtimeProcess.cwd()
    const outsideRepo = await tmpDir()

    try {
      runtimeProcess.chdir(outsideRepo)
      expect(() => Repo.getRoot()).toThrow(Errors.CommandExecutionError)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })
})

describe('Log', () => {
  test('uses swappable transports', () => {
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

    expect(calls[0]).toBe('debug:debug')
    expect(calls[1]).toBe('info:hello')
    expect(calls[2]).toBe('warn:heads up')
    expect(calls[3]).toContain('error:failed:Error: boom')
    expect(calls[4]).toBe('success:done')
    expect(calls[5]).toBe('user:shown')
    expect('trace' in Log).toBe(false)
    expect('withTransport' in Log).toBe(false)
  })
})

describe('Errors, Assert, and Switch', () => {
  test('formats Tao errors for users and logs', () => {
    const userError = new Errors.UserInputError('No file selected')
    const unexpected = Errors.fromUnknown('surprise', { while: 'testing' })

    expect(Errors.isTaoError(userError)).toBe(true)
    expect(Errors.formatForUser(userError)).toBe('No file selected')
    expect(Errors.formatForLog(unexpected)).toContain('UnexpectedBehaviorError')
    expect(Errors.formatForLog(unexpected)).toContain('surprise')
  })

  test('asserts conditions and narrows values', () => {
    const value: string | undefined = 'tao'

    Assert(value, 'value exists')
    Assert.defined(value, 'value is defined')
    Assert.is(value, isString, 'value is a string')
    expect(value.toUpperCase()).toBe('TAO')
    expect(() => Assert(false, 'truthy')).toThrow(Errors.UnexpectedBehaviorError)
  })

  test('switches exhaustively by value, type, and property', () => {
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

    expect(selectedValue).toBe(1)
    expect(selectedOptionalValue).toBe('normal')
    expect(selectedType).toBe('hello')
    expect(selectedProperty).toBe('Ready')
  })
})

describe('Text', () => {
  test('strips shared indentation from multiline strings', () => {
    expect(Text.stripIndent(`
      first
        second
      third
    `)).toBe('first\n  second\nthird')
  })

  test('preserves relative indentation and blank interior lines', () => {
    expect(Text.stripIndent(`
        first

          second
    `)).toBe('first\n\n  second')
  })

  test('indents selected lines', () => {
    expect(Text.indentLines('first\n\nsecond', 2)).toBe('  first\n  \n  second')
    expect(Text.indentLines('first\n\nsecond', 2, { skipBlankLines: true, skipFirstLine: true })).toBe(
      'first\n\n  second',
    )
  })

  test('escapes regexp metacharacters', () => {
    const literal = 'a+b?.[x]'
    expect(new RegExp(Text.escapeRegExp(literal)).test(literal)).toBe(true)
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
