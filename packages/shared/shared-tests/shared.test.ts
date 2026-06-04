import { Assert, CLI, Errors, FS, HCI, Log, Repo, Switch } from '../shared-src/shared'
import { afterEach, describe, expect, PassThrough, runtimeProcess, test, Writable } from './TestRuntime'

const cleanupPaths: string[] = []

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await FS.remove(path)
  }
})

describe('FS', () => {
  test('writes and reads text and json files', async () => {
    const root = await tmpDir()
    const textPath = FS.joinPath(root, 'nested', 'hello.txt')
    const jsonPath = FS.joinPath(root, 'nested', 'data.json')

    await FS.writeText(textPath, 'hello')
    await FS.writeJson(jsonPath, { answer: 42 })

    expect(await FS.readText(textPath)).toBe('hello')
    expect(await FS.readJson<{ answer: number }>(jsonPath)).toEqual({ answer: 42 })
    expect(await FS.isFile(textPath)).toBe(true)
    expect(await FS.isDirectory(FS.dirname(textPath))).toBe(true)
  })

  test('copies, moves, lists, and removes paths', async () => {
    const root = await tmpDir()
    const sourcePath = FS.joinPath(root, 'source.txt')
    const copyPath = FS.joinPath(root, 'copies', 'copy.txt')
    const movedPath = FS.joinPath(root, 'moved', 'copy.txt')

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
    const sourceDir = FS.joinPath(root, 'src')
    const copyDir = FS.joinPath(root, 'copy')

    await FS.writeText(FS.joinPath(sourceDir, 'a.ts'), 'a')
    await FS.writeText(FS.joinPath(sourceDir, 'b.txt'), 'b')
    await FS.writeText(FS.joinPath(sourceDir, '.hidden.ts'), 'hidden')
    await FS.writeText(FS.joinPath(sourceDir, 'nested', 'c.ts'), 'c')
    await FS.copyDirectory(sourceDir, copyDir)

    const walked: string[] = []
    for await (const path of FS.walk(copyDir, { extensions: ['.ts'] })) {
      walked.push(path)
    }

    expect(walked.sort()).toEqual([
      FS.joinPath(copyDir, 'a.ts'),
      FS.joinPath(copyDir, 'nested', 'c.ts'),
    ])
  })

  test('does not swallow read or list errors', async () => {
    const root = await tmpDir()

    await expect(FS.readText(FS.joinPath(root, 'missing.txt'))).rejects.toThrow()
    await expect(FS.listDir(FS.joinPath(root, 'missing'))).rejects.toThrow()
  })
})

describe('HCI', () => {
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
    const result = await CLI.run({
      command: runtimeProcess.execPath,
      args: ['-e', 'console.log(process.cwd()); console.error(process.env.TAO_CLI_TEST)'],
      cwd: root,
      env: { TAO_CLI_TEST: 'ok' },
    })

    expect(result.exitCode).toBe(0)
    expect(FS.basename(result.stdout.trim())).toBe(FS.basename(root))
    expect(result.stderr.trim()).toBe('ok')
  })

  test('passes stdin to commands', async () => {
    const result = await CLI.run({
      command: runtimeProcess.execPath,
      args: ['-e', 'for await (const chunk of process.stdin) process.stdout.write(chunk.toString().toUpperCase())'],
      stdin: 'abc',
    })

    expect(result.stdout).toBe('ABC')
  })

  test('returns unchecked failures and throws checked failures', async () => {
    const command = {
      command: runtimeProcess.execPath,
      args: ['-e', 'console.error("bad"); process.exit(7)'],
    }

    const result = await CLI.run(command)

    expect(result.exitCode).toBe(7)
    expect(result.stderr.trim()).toBe('bad')
    await expect(CLI.mustRun(command)).rejects.toBeInstanceOf(Errors.CommandExecutionError)
  })

  test('formats commands and supports inherited stdio', async () => {
    expect(CLI.formatCommand({ command: 'tao', args: ['run', 'Hello World.tao'] })).toBe('tao run "Hello World.tao"')

    const result = await CLI.run({
      command: runtimeProcess.execPath,
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
      const result = await CLI.run({
        command: runtimeProcess.execPath,
        args: ['-e', 'console.log(`out`); console.error(`err`)'],
        stdio: 'stream',
      })

      expect(result.stdout.trim()).toBe('out')
      expect(result.stderr.trim()).toBe('err')
      expect(streamedStdout.trim()).toBe('out')
      expect(streamedStderr.trim()).toBe('err')
    } finally {
      runtimeProcess.stdout = stdout
      runtimeProcess.stderr = stderr
    }
  })
})

describe('Repo', () => {
  test('finds the current git worktree root from a nested cwd', async () => {
    const cwd = runtimeProcess.cwd()
    const root = await Repo.getRoot()

    try {
      runtimeProcess.chdir(FS.joinPath(root, 'packages', 'shared'))
      expect(await Repo.getRoot()).toBe(root)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })

  test('finds a nested git repo root without using an outer root', async () => {
    const cwd = runtimeProcess.cwd()
    const outerRoot = await tmpDir()
    const taoRoot = FS.joinPath(outerRoot, 'workspace', 'tao')
    const nestedDir = FS.joinPath(taoRoot, 'packages', 'shared')

    await FS.mkdir(nestedDir)
    await CLI.mustRun({ command: 'git', args: ['init'], cwd: taoRoot })
    const expectedRoot = await Repo.getRoot(taoRoot)

    try {
      runtimeProcess.chdir(nestedDir)
      expect(await Repo.getRoot()).toBe(expectedRoot)
    } finally {
      runtimeProcess.chdir(cwd)
    }
  })

  test('rejects outside a git worktree', async () => {
    const cwd = runtimeProcess.cwd()
    const outsideRepo = await tmpDir()

    try {
      runtimeProcess.chdir(outsideRepo)
      await expect(Repo.getRoot()).rejects.toBeInstanceOf(Errors.CommandExecutionError)
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

async function tmpDir() {
  const dir = await FS.mkTmpDir(FS.joinPath(FS.tmpdir(), 'tao-shared-test-'))
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

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
