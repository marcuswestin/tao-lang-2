import { CLI, Errors, Platform, Repo } from '@shared'
import { Deferred, Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import { Protocol } from '../expo-host-src/testing/test-compiler/Protocol'
import type * as TestCompiler from '../expo-host-src/testing/test-compiler/TestCompiler'
import { WorkerSession, WorkerTesting } from '../expo-host-src/testing/test-compiler/Worker'

type FakeCommand = {
  command: CLI.StartedCommand
  events: string[]
}

Describe('test compiler worker session', () => {
  Test('round-trips Tao error categories without exposing raw worker failures', () => {
    const failures = [
      new Errors.UserInputError('Fix the test input.'),
      new Errors.UnexpectedBehaviorError('Compiler invariant failed.'),
      new Errors.HostEnvironmentError('Compiler host unavailable.'),
    ]

    const restored = failures.map(error => Protocol.errorFromFailure(Protocol.failureFromError(error)))
    Expect(restored[0]).toBeInstanceOf(Errors.UserInputError)
    Expect(restored[1]).toBeInstanceOf(Errors.UnexpectedBehaviorError)
    Expect(restored[2]).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(restored.map(Errors.messageOf)).toEqual(failures.map(Errors.messageOf))

    const unknown = Protocol.errorFromFailure(Protocol.failureFromError({ message: 'secret compiler stack' }))
    Expect(unknown).toBeInstanceOf(Errors.UnexpectedBehaviorError)
    Expect(Errors.messageOf(unknown)).toBe('Something went wrong while compiling Tao tests.')
  })

  Test('reports a generated-directory rename denial as a host failure', () => {
    // A Node filesystem failure is a plain Error with errno fields, not a Tao error.
    const denied = Object.assign(Errors.abortError('filesystem operation failed'), {
      code: 'EPERM',
      dest: '/checkout/.compiled/hash',
      path: '/checkout/run/_gen_tao-app',
      syscall: 'rename',
    })

    const failure = Protocol.failureFromError(denied)
    Expect(failure.category).toBe('host')
    Expect(failure.message).toContain("rename '/checkout/run/_gen_tao-app'")
    Expect(failure.message).toContain("to '/checkout/.compiled/hash'")
    Expect(failure.message).toContain('EPERM')
  })

  Test('bounds and sanitizes categorized worker messages and fatal stderr', () => {
    const failure = Protocol.failureFromError(
      new Errors.UserInputError(`bad\u001b[31m\u0000${'x'.repeat(2_000)}`),
    )
    Expect(failure.message.includes('\u001b')).toBe(false)
    Expect(failure.message.includes('\u0000')).toBe(false)
    Expect(failure.message.length).toBe(800)

    const close = WorkerTesting.formatWorkerClose(
      { exitCode: 1, signal: null },
      `old-secret\u001b[31m${'y'.repeat(2_500)}\u0000tail`,
    )
    Expect(close).toStartWith('Test compiler worker exited with 1.\n…')
    Expect(close.includes('old-secret')).toBe(false)
    Expect(close.includes('\u001b')).toBe(false)
    Expect(close.includes('\u0000')).toBe(false)
    Expect(close).toEndWith('tail')
  })

  Test('allows the worker to stop gracefully after stdin ends', async () => {
    const fake = fakeCommand()

    await WorkerTesting.stopCommand(fake.command, {
      waitForClose: async () => ({ exitCode: 0, signal: null }),
    })

    Expect(fake.events).toEqual(['end-stdin', 'close-output', 'dispose'])
  })

  Test('releases child-process resources when close never arrives', async () => {
    const fake = fakeCommand()

    await WorkerTesting.stopCommand(fake.command, {
      waitForClose: async () => undefined,
    })

    Expect(fake.events).toEqual([
      'end-stdin',
      'kill SIGTERM',
      'kill SIGKILL',
      'close-output',
      'dispose',
    ])
  })

  Test('does not restart after the session is stopped', async () => {
    const session = new WorkerSession()

    await session.stop()

    await Expect(session.validateTestFile('/unused.test.tao')).rejects.toThrow(
      'Test compiler worker session is stopped.',
    )
  })

  for (
    const line of [
      'Parser warning: ambiguous grammar',
      'null',
      '{}',
      '{"id":"1","output":{"kind":"validate","errors":[]}}',
      '{"id":1}',
      '{"id":999,"output":{"kind":"validate","errors":[]}}',
      '{"id":1,"error":{"category":"user","message":"secret"},"output":{"kind":"validate","errors":[]}}',
      '{"id":1,"error":{"category":"unknown","message":"secret"}}',
      '{"id":1,"output":{"kind":"validate","errors":null}}',
      '{"id":1,"output":{"kind":"constructor"}}',
      '{"id":1,"output":{"kind":"app","app":{"testAppPath":"wrong-request"}}}',
    ]
  ) {
    Test(`rejects every pending request and shuts down after invalid worker output ${line}`, async () => {
      const connection = fakeConnection()
      const session = new WorkerSession(connection.start)
      const first = session.validateTestFile('/first.test.tao')
      const second = session.validateTestFile('/second.test.tao')
      const results = Promise.allSettled([first, second])
      try {
        await until(() => connection.requests.length === 2, { description: 'both worker requests to be sent' })
        Expect(() => connection.output(`${line}\n{"id":2,"output":{"kind":"validate","errors":[]}}\n`))
          .not.toThrow()
        const settled = await until(() => results, { description: 'invalid worker output to reject both requests' })
        for (const result of settled) {
          Expect(result.status).toBe('rejected')
          if (result.status === 'rejected') {
            Expect(result.reason).toBeInstanceOf(Errors.UnexpectedBehaviorError)
            Expect(Errors.messageOf(result.reason)).toBe('Test compiler worker returned an invalid protocol response.')
          }
        }
        await until(() => connection.events.includes('dispose'), {
          description: 'invalid worker output to stop its child',
        })
        Expect(connection.events).toContain('end-stdin')
        Expect(connection.events).toContain('close-output')
        Expect(connection.events).toContain('dispose')
        await Expect(session.validateTestFile('/later.test.tao')).rejects.toThrow(
          'Test compiler worker session is stopped.',
        )
        Expect(connection.requests.length).toBe(2)
      } finally {
        await session.stop()
      }
    })
  }

  Test('retains valid chunked responses and categorized author failures on the worker connection', async () => {
    const connection = fakeConnection()
    const session = new WorkerSession(connection.start)
    const first = session.validateTestFile('/first.test.tao')
    const second = session.validateTestFile('/second.test.tao')
    const results = Promise.allSettled([first, second])
    try {
      await until(() => connection.requests.length === 2, { description: 'both valid worker requests to be sent' })
      const requests = connection.requests.map(Protocol.parseRequest)
      const firstId = requests.find(request =>
        request.input.kind === 'validate' && request.input.testFilePath === '/first.test.tao'
      )!.id
      const secondId = requests.find(request =>
        request.input.kind === 'validate' && request.input.testFilePath === '/second.test.tao'
      )!.id
      connection.output(`{"id":${firstId},"output":{"kind":"validate",`)
      connection.output(
        `"errors":[]}}\n{"id":${secondId},"error":{"category":"user","message":"Fix the test input."}}\n`,
      )
      const settled = await results
      Expect(settled[0]).toEqual({ status: 'fulfilled', value: [] })
      Expect(settled[1]!.status).toBe('rejected')
      if (settled[1]!.status === 'rejected') {
        Expect(settled[1]!.reason).toBeInstanceOf(Errors.UserInputError)
        Expect(Errors.messageOf(settled[1]!.reason)).toBe('Fix the test input.')
      }
      Expect(connection.events).toEqual([])
    } finally {
      await session.stop()
    }
  })

  const file = workerTestFile()
  const suite = file.suites[0]!
  const check = suite.checks[0]!
  for (
    const [description, invalidFile] of [
      ['missing metadata', { suites: [null] }],
      ['unsupported version', { ...file, version: 2 }],
      ['missing source path', { version: 1, suites: [] }],
      ['null suite', { ...file, suites: [null] }],
      ['missing suite name', { ...file, suites: [{ source: suite.source, checks: [] }] }],
      ['missing suite source', { ...file, suites: [{ name: 'Wire', checks: [] }] }],
      ['null checks', { ...file, suites: [{ ...suite, checks: null }] }],
      ['null check', { ...file, suites: [{ ...suite, checks: [null] }] }],
      ['missing check name', {
        ...file,
        suites: [{ ...suite, checks: [{ source: check.source, app: check.app, steps: [] }] }],
      }],
      ['missing check source', {
        ...file,
        suites: [{ ...suite, checks: [{ name: 'renders', app: check.app, steps: [] }] }],
      }],
      ['invalid source range', {
        ...file,
        suites: [{ ...suite, checks: [{ ...check, source: { filePath: '/Main.test.tao', range: null } }] }],
      }],
      ['null app', { ...file, suites: [{ ...suite, checks: [{ ...check, app: null }] }] }],
      ['missing app paths', { ...file, suites: [{ ...suite, checks: [{ ...check, app: {} }] }] }],
      ['null steps', { ...file, suites: [{ ...suite, checks: [{ ...check, steps: null }] }] }],
      ['null step', { ...file, suites: [{ ...suite, checks: [{ ...check, steps: [null] }] }] }],
      ['missing step fields', {
        ...file,
        suites: [{ ...suite, checks: [{ ...check, steps: [{ kind: 'expect', source: check.source }] }] }],
      }],
      ['null nested step', {
        ...file,
        suites: [{
          ...suite,
          checks: [{
            ...check,
            steps: [{ kind: 'select', tag: 'row', index: 1, source: check.source, steps: [null] }],
          }],
        }],
      }],
    ]
  ) {
    Test(`rejects a malformed test plan with ${description} while another request is pending`, async () => {
      const connection = fakeConnection()
      const session = new WorkerSession(connection.start)
      const first = session.compileTestPlan('/Main.test.tao', { runRoot: '/unused' })
      const second = session.validateTestFile('/second.test.tao')
      const results = Promise.allSettled([first, second])
      try {
        await until(() => connection.requests.length === 2, {
          description: 'the test-plan and validation requests to be sent',
        })
        const requests = connection.requests.map(Protocol.parseRequest)
        const planId = requests.find(request => request.input.kind === 'testPlan')!.id
        const validationId = requests.find(request => request.input.kind === 'validate')!.id
        connection.output(
          `${JSON.stringify({ id: planId, output: { kind: 'testPlan', file: invalidFile } })}\n`
            + Protocol.responseLine({ id: validationId, output: { kind: 'validate', errors: [] } }),
        )
        const settled = await until(() => results, { description: 'the malformed test plan to reject both requests' })
        for (const result of settled) {
          Expect(result.status).toBe('rejected')
          if (result.status === 'rejected') {
            Expect(result.reason).toBeInstanceOf(Errors.UnexpectedBehaviorError)
            Expect(Errors.messageOf(result.reason)).toBe('Test compiler worker returned an invalid protocol response.')
          }
        }
        await until(() => connection.events.includes('close-output'), {
          description: 'the malformed test plan to stop its worker',
        })
        Expect(connection.events).toContain('end-stdin')
        Expect(connection.events).toContain('dispose')
        await Expect(session.validateTestFile('/later.test.tao')).rejects.toThrow(
          'Test compiler worker session is stopped.',
        )
      } finally {
        await session.stop()
      }
    })
  }

  Test('returns a complete test plan through the worker connection', async () => {
    const connection = fakeConnection()
    const session = new WorkerSession(connection.start)
    const result = session.compileTestPlan('/Main.test.tao', { runRoot: '/unused' })
    try {
      await until(() => connection.requests.length === 1, { description: 'the valid test-plan request to be sent' })
      const request = Protocol.parseRequest(connection.requests[0]!)
      connection.output(Protocol.responseLine({ id: request.id, output: { kind: 'testPlan', file } }))
      Expect(await result).toEqual(file)
      Expect(connection.events).toEqual([])
    } finally {
      await session.stop()
    }
  })

  Test('keeps real worker stdout as two JSONL responses while validating bare renders and guard payloads', async () => {
    await withTaoFiles('worker-jsonl-', {
      'Main.tao': `
        use ReadContext from @tao/data
        app Sample { id "sample" version "1.0.0" name "Sample" view Main
          guard { loading -> Context { Handler(Context) } }
        }
        view Main { render Container { Leaf Leaf() } }
        view Container { render inject Content @@content \`\`\`ts return Content \`\`\` }
        view Leaf { render inject \`\`\`ts return null \`\`\` }
        view Handler(Value ReadContext) { render Leaf }
      `,
      'Main.test.tao': 'use Sample from ./Main test "Wire" { test "renders" { run Sample expect text "Ready" } }',
    }, async paths => {
      let stdout = ''
      let stderr = ''
      const command = CLI.start(Platform.runtimeProcess.execPath, {
        args: ['run', Repo.resolvePath('packages/apps/expo-host/expo-host-src/testing/test-compiler/WorkerProcess.ts')],
        cwd: Repo.getRoot(),
        onOutput: (stream, chunk) => {
          if (stream === 'stdout') {
            stdout += chunk.toString('utf8')
          } else {
            stderr += chunk.toString('utf8')
          }
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      try {
        Expect(command.writeStdin(Protocol.requestLine({
          id: 41,
          input: { kind: 'validate', testFilePath: paths['Main.test.tao']! },
        }))).toBe(true)
        Expect(command.writeStdin(Protocol.requestLine({
          id: 42,
          input: { kind: 'validate', testFilePath: paths['Main.test.tao']! },
        }))).toBe(true)
        command.endStdin()
        const close = await until(() => command.waitForClose(), { description: 'the real worker to finish after EOF' })
        await command.closeOutput()
        Expect(close.exitCode).toBe(0)
        Expect(stderr).toBe('')
        const lines = stdout.trim().split('\n')
        Expect(lines.length).toBe(2)
        Expect(lines.map(line => JSON.parse(line))).toEqual([
          { id: 41, output: { kind: 'validate', errors: [] } },
          { id: 42, output: { kind: 'validate', errors: [] } },
        ])
      } finally {
        await WorkerTesting.stopCommand(command)
      }
    })
  })
})

function workerTestFile(): TestCompiler.File {
  return {
    version: 1,
    sourcePath: '/Main.test.tao',
    suites: [{
      name: 'Wire',
      source: {
        filePath: '/Main.test.tao',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
      },
      checks: [{
        name: 'renders',
        source: { filePath: '/Main.test.tao' },
        app: { modulePath: '/App.tsx', sourcePath: '/Main.tao' },
        steps: [{
          kind: 'expect',
          selector: 'text',
          text: 'Ready',
          missing: false,
          source: { filePath: '/Main.test.tao' },
        }],
      }],
    }],
  }
}

function fakeConnection() {
  const fake = fakeCommand()
  const closed = Deferred<CLI.CommandCloseResult>()
  const requests: string[] = []
  let onOutput: CLI.CommandSpec['onOutput']
  fake.command.waitForClose = () => closed.promise
  fake.command.writeStdin = chunk => {
    requests.push(String(chunk))
    return true
  }
  fake.command.endStdin = () => {
    fake.events.push('end-stdin')
    closed.resolve({ exitCode: 0, signal: null })
  }
  return {
    events: fake.events,
    output: (line: string) => onOutput?.('stdout', Buffer.from(line)),
    requests,
    start: (_command: string, spec: CLI.CommandSpec = {}) => {
      onOutput = spec.onOutput
      return fake.command
    },
  }
}

function fakeCommand(): FakeCommand {
  const events: string[] = []
  return {
    command: {
      args: [],
      closeOutput: async () => {
        events.push('close-output')
      },
      command: 'fake-worker',
      dispose: () => events.push('dispose'),
      endStdin: () => events.push('end-stdin'),
      exitCode: null,
      kill: signal => {
        events.push(`kill ${signal ?? 'SIGTERM'}`)
        return true
      },
      onceClose() {},
      onceError() {},
      signalCode: null,
      waitForClose: async () => await new Promise<CLI.CommandCloseResult>(() => {}),
      writeStdin: () => true,
    },
    events,
  }
}
