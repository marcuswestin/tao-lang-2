import { Errors, FS, Time } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import type { MetroStarter } from '../cli-src/hosted-crud-metro'
import { hostedCrudRunCommand, runHostedCrud, taoAppRunCommand } from '../cli-src/hosted-crud-run'

async function expoProject(root: string): Promise<string> {
  const project = FS.resolvePath('Apps/Hosted CRUD', root)
  await FS.writeJson(FS.resolvePath('app.json', project), { expo: { slug: 'demo' } })
  await FS.writeText(FS.resolvePath('node_modules/.bin/expo', root), '#!/bin/sh\n')
  return project
}

function scriptedExpo(whoami: { exitCode: number; stdout: string }[]) {
  const calls: string[] = []
  const runner = async (_expo: string, args: readonly string[]) => {
    calls.push(args.join(' '))
    if (args[0] === 'whoami') {
      return { ...whoami.shift()!, stderr: '' }
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  return { calls, runner }
}

/** fakeMetro stands in for headless Expo CLI: it answers Metro's HTTP routes and writes reporter events once started. */
function fakeMetro(events: object[], options: { exitCode?: number; stopGate?: Promise<void> } = {}) {
  const requests: string[] = []
  let stops = 0
  let started: { args: readonly string[]; env: Record<string, string> } | undefined
  let finish = (_code: number | null) => {}
  const exited = new Promise<number | null>(resolve => (finish = resolve))
  const metro: MetroStarter = spec => {
    started = spec
    if (options.exitCode === undefined) {
      void FS.writeText(spec.env['TAO_METRO_EVENTS']!, events.map(event => `${JSON.stringify(event)}\n`).join(''))
    } else {
      finish(options.exitCode)
    }
    return {
      exited,
      output: () => 'Starting Metro Bundler\nCommandError: port 8081 is busy\n',
      stop: async () => {
        stops++
        await options.stopGate
        finish(null)
      },
    }
  }
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
    if (url.pathname === '/status') {
      return new Response(started && options.exitCode === undefined ? 'packager-status:running' : '', {
        status: started ? 200 : 503,
      })
    }
    if (url.pathname === '/_expo/open' && init?.method !== 'POST') {
      return Response.json({ url: 'exp://192.168.1.5:8081', runtime: 'expo' })
    }
    return new Response('ok')
  }
  return {
    fetch,
    metro,
    pollMs: 5,
    port: 8081,
    requests,
    started: () => started,
    stops: () => stops,
    exit: (code: number) => finish(code),
  }
}

async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; !check(); tries++) {
    if (tries > 400) {
      Errors.throwUnexpected('condition never held')
    }
    await Time.sleep(10)
  }
}

const bundleEvents = [
  { type: 'bundle_build_started', buildID: '1', bundleDetails: { platform: 'ios' } },
  { type: 'bundle_transform_progressed_throttled', buildID: '1', transformedFileCount: 50, totalFileCount: 200 },
  { type: 'bundle_build_done', buildID: '1' },
  { type: 'bundle_transform_progressed_throttled', buildID: '1', transformedFileCount: 200, totalFileCount: 200 },
  {
    type: 'bundling_error',
    error: { message: 'SyntaxError: Unexpected token (3:4)', filename: 'src/App.tsx', lineNumber: 3, column: 4 },
  },
  { type: 'client_log', level: 'warn', data: ['hello', { id: 1 }] },
]

Describe('tao connect run', () => {
  Test('prints the ordinary app run command from its app folder with the local repository wrapper', async () => {
    const root = await mkTestDir('tao-app-run-command-')
    try {
      await FS.writeText(FS.resolvePath('tao', root), '')
      await FS.writeText(FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', root), '')
      const project = FS.resolvePath('Apps/Hosted Firebase', root)
      await FS.mkdir(project)
      Expect(await taoAppRunCommand(project, 'FirebaseNotes', project)).toBe('../../tao run . --app FirebaseNotes')
      Expect(await taoAppRunCommand(project, 'FirebaseNotes', root)).toBe(
        "./tao run 'Apps/Hosted Firebase' --app FirebaseNotes",
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test('shows the compact action line, contextual device guidance, bundling, errors and logs', async () => {
    const root = await mkTestDir('tao-connect-run-login-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 0, stdout: '\u001b[32mdev-user\u001b[39m\n' }])
      const terminal = fakeTerminal()
      const fake = fakeMetro(bundleEvents)
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })
      await until(() => terminal.outputText().includes('app warn:'))
      Expect(calls).toEqual([])
      terminal.input.write('d')
      await until(() => terminal.outputText().includes('sign in as dev-user'))
      terminal.input.write('r')
      await until(() => fake.requests.includes('GET /message?method=reload'))
      terminal.input.write('a')
      await until(() => fake.requests.includes('POST /_expo/open?platform=android'))
      await until(() => terminal.outputText().includes('Opened Expo Go in the Android emulator.'))
      terminal.input.write('c')
      await until(() => terminal.outputText().split('Expo Go address:').length >= 4)
      terminal.input.write('?')
      await until(() => terminal.outputText().split('Expo Go address:').length >= 5)
      terminal.input.write('q')
      await running

      const output = terminal.outputText()
      Expect(calls).toEqual(['whoami'])
      Expect(fake.started()?.args.slice(2)).toEqual([
        FS.resolvePath('node_modules/.bin/expo', root),
        'start',
        '--go',
        '--port',
        '8081',
      ])
      Expect(fake.started()?.args.slice(0, 2)).toEqual([
        '--require',
        FS.resolvePath('.tao/cache/connect-run/metro-events.cjs', project),
      ])
      Expect(fake.started()?.env['TAO_METRO_EVENTS'])
        .toBe(FS.resolvePath('.tao/cache/connect-run/metro-events.jsonl', project))
      Expect(output).toContain('For iPhone, open Expo Go Home, tap the account icon, and sign in as dev-user')
      Expect(output).toContain('exp://192.168.1.5:8081')
      Expect(output).toContain('\u001b[48;2;255;255;255m')
      Expect(output).toContain('\u001b[48;2;0;0;0m')
      Expect(output).toContain('Scan in Expo Go on Android, or with the iPhone camera.')
      Expect(output).toContain('iOS: bundling 25% (50/200 files)')
      Expect(output).toMatch(/iOS bundled in [\d.]+s \(200 files\)/u)
      Expect(output.slice(output.indexOf('iOS bundled in'))).not.toContain('iOS: bundling')
      Expect(output).toContain('Bundling failed in src/App.tsx:3:4.')
      Expect(output).toContain('SyntaxError: Unexpected token (3:4)')
      Expect(output).toContain('hello {"id":1}')
      Expect(output).toContain('Reloading connected apps.')
      Expect(output).toContain(
        'Actions: r reload · i iOS Simulator · a Android emulator · c Show connection · d Device (Android/iPhone) · ? show this again · q quit',
      )
      Expect(output).not.toContain('Open the app on')
      Expect(output).toContain('Opened Expo Go in the Android emulator.')
      Expect(output).toContain('Shutting down… stopping Metro and its child processes.')
      Expect(output).toContain('Metro stopped.')
      Expect(fake.requests).not.toContain('POST /_expo/open?platform=ios')
      Expect(await FS.exists(FS.resolvePath('.tao/cache/connect-run/expo.log', project))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('restores another active build after completion or failure, then clears the final status', async () => {
    const root = await mkTestDir('tao-connect-run-progress-')
    try {
      const project = await expoProject(root)
      const terminal = fakeTerminal()
      const fake = fakeMetro([
        { type: 'bundle_build_started', buildID: 'ios', bundleDetails: { platform: 'ios' } },
        { type: 'bundle_transform_progressed_throttled', buildID: 'ios', transformedFileCount: 1, totalFileCount: 2 },
        { type: 'bundle_build_started', buildID: 'android', bundleDetails: { platform: 'android' } },
        { type: 'bundle_build_done', buildID: 'android' },
        { type: 'client_log', data: ['after second build'] },
        { type: 'bundle_build_started', buildID: 'web', bundleDetails: { platform: 'web' } },
        { type: 'bundle_build_failed', buildID: 'web' },
        { type: 'client_log', data: ['after failed build'] },
        { type: 'bundle_build_done', buildID: 'ios' },
        { type: 'bundle_transform_progressed_throttled', buildID: 'ios', transformedFileCount: 2, totalFileCount: 2 },
        { type: 'client_log', data: ['after all builds'] },
      ])
      const running = runHostedCrud(project, { ...terminal, ...fake })
      await until(() => terminal.outputText().includes('after all builds'))
      terminal.input.write('q')
      await running

      const output = terminal.outputText()
      const afterSecond = output.slice(output.indexOf('Android bundled in'), output.indexOf('after second build'))
      const afterFailed = output.slice(output.indexOf('after failed build'))
      Expect(afterSecond).toContain('iOS: bundling 50% (1/2 files)')
      Expect(afterFailed.slice(0, afterFailed.indexOf('iOS bundled in'))).toContain('iOS: bundling 50% (1/2 files)')
      Expect(afterFailed).toContain('iOS bundled in')
      Expect(afterFailed.slice(afterFailed.indexOf('iOS bundled in'))).not.toContain('iOS: bundling')
    } finally {
      await FS.remove(root)
    }
  })

  Test('shows the QR only after d, including when c repeats the connection', async () => {
    const root = await mkTestDir('tao-connect-run-device-qr-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })
      await until(() => terminal.outputText().includes('Actions:'))
      Expect(terminal.outputText()).toContain('Expo Go address:')
      Expect(terminal.outputText()).not.toContain('\u001b[48;2;0;0;0m')
      Expect(terminal.outputText()).not.toContain('Scan in Expo Go')

      terminal.input.write('c')
      await until(() => terminal.outputText().split('Expo Go address:').length >= 3)
      Expect(terminal.outputText()).not.toContain('\u001b[48;2;0;0;0m')

      terminal.input.write('i')
      await until(() => fake.requests.includes('POST /_expo/open?platform=ios'))
      terminal.input.write('a')
      await until(() => fake.requests.includes('POST /_expo/open?platform=android'))
      Expect(terminal.outputText()).not.toContain('\u001b[48;2;0;0;0m')
      Expect(calls).toEqual([])

      terminal.input.write('d')
      await until(() => terminal.outputText().includes('Scan in Expo Go'))
      Expect(terminal.outputText()).toContain('\u001b[48;2;0;0;0m')
      const beforeRepeat = terminal.outputText().length
      terminal.input.write('c')
      await until(() => terminal.outputText().split('Expo Go address:').length >= 5)
      Expect(terminal.outputText().slice(beforeRepeat)).toContain('\u001b[48;2;0;0;0m')
      terminal.input.write('q')
      await running
      Expect(calls).toEqual(['whoami'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('ignores reload queued after quit', async () => {
    const root = await mkTestDir('tao-connect-run-quit-keys-')
    try {
      const project = await expoProject(root)
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      const running = runHostedCrud(project, { ...terminal, ...fake })
      await until(() => terminal.outputText().includes('Actions:'))
      terminal.input.write('qr')
      await running
      Expect(fake.requests).not.toContain('GET /message?method=reload')
      Expect(terminal.outputText()).not.toContain('Reloading connected apps.')
      Expect(terminal.outputText()).toContain('Metro stopped.')
    } finally {
      await FS.remove(root)
    }
  })

  Test('shows shutdown progress while Metro stop is pending and completes only afterward', async () => {
    const root = await mkTestDir('tao-connect-run-slow-stop-')
    try {
      const project = await expoProject(root)
      let releaseStop = () => {}
      const stopGate = new Promise<void>(resolve => (releaseStop = resolve))
      const terminal = fakeTerminal()
      const fake = fakeMetro([], { stopGate })
      let completed = false
      const running = runHostedCrud(project, { ...terminal, ...fake }).then(() => (completed = true))
      await until(() => terminal.outputText().includes('Actions:'))
      terminal.input.write('q')
      await until(() => terminal.outputText().includes('Shutting down… stopping Metro and its child processes.'))
      Expect(completed).toBe(false)
      Expect(terminal.outputText()).not.toContain('Metro stopped.')
      releaseStop()
      await running
      Expect(terminal.outputText()).toContain('Metro stopped.')
    } finally {
      await FS.remove(root)
    }
  })

  Test('quits without waiting for a stalled account lookup or printing its late result', async () => {
    const root = await mkTestDir('tao-connect-run-quit-device-')
    try {
      const project = await expoProject(root)
      let completeLookup = (_result: { exitCode: number; stdout: string }) => {}
      const lookup = new Promise<{ exitCode: number; stdout: string }>(resolve => (completeLookup = resolve))
      let lookupStarted = false
      let lookupSignal: AbortSignal | undefined
      const runner = async (
        _expo: string,
        _args: readonly string[],
        _cwd: string,
        _interactive: boolean,
        signal?: AbortSignal,
      ) => {
        lookupStarted = true
        lookupSignal = signal
        return { ...await lookup, stderr: '' }
      }
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      let completed = false
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner }).then(
        () => (completed = true),
      )
      await until(() => terminal.outputText().includes('Actions:'))
      terminal.input.write('d')
      await until(() => lookupStarted)
      terminal.input.write('qq')
      await until(() => terminal.outputText().includes('Shutting down…'))
      await until(() => completed)
      await running
      const output = terminal.outputText()
      const stoppedAt = output.indexOf('Metro stopped.')
      Expect(stoppedAt).toBeGreaterThan(-1)
      Expect(output.slice(output.indexOf('Shutting down…'))).not.toContain('Expo Go address:')
      Expect(output).not.toContain('\u001b[48;2;0;0;0m')
      Expect(output).not.toContain('Scan in Expo Go')
      Expect(lookupSignal?.aborted).toBe(true)
      Expect(fake.stops()).toBe(1)
      completeLookup({ exitCode: 0, stdout: 'dev-user\n' })
      await Time.sleep(0)
      Expect(terminal.outputText()).toBe(output)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports an unexpected Metro exit while account lookup remains stalled', async () => {
    const root = await mkTestDir('tao-connect-run-exit-device-')
    try {
      const project = await expoProject(root)
      let lookupSignal: AbortSignal | undefined
      const runner = (
        _expo: string,
        _args: readonly string[],
        _cwd: string,
        _interactive: boolean,
        signal?: AbortSignal,
      ) => {
        lookupSignal = signal
        return new Promise<{ exitCode: number; stdout: string; stderr: string }>(() => {})
      }
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      let finished = false
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner }).catch(error => {
        finished = true
        return Errors.formatForUser(error)
      })
      await until(() => terminal.outputText().includes('Actions:'))
      terminal.input.write('d')
      await until(() => lookupSignal !== undefined)
      fake.exit(2)
      await until(() => finished)
      Expect(await running).toContain('Expo CLI stopped with code 2.')
      Expect(lookupSignal?.aborted).toBe(true)
      Expect(fake.stops()).toBe(1)
      Expect(terminal.outputText()).not.toContain('Metro stopped.')
      Expect(terminal.outputText()).not.toContain('Scan in Expo Go')
    } finally {
      await FS.remove(root)
    }
  })

  Test('quits while reload HTTP is stalled, aborting it without waiting for a response', async () => {
    const root = await mkTestDir('tao-connect-run-quit-reload-')
    try {
      const project = await expoProject(root)
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      let reloadStarted = false
      let reloadAborted = false
      const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (new URL(String(input)).pathname === '/message') {
          reloadStarted = true
          init?.signal?.addEventListener('abort', () => (reloadAborted = true), { once: true })
          return await new Promise<Response>(() => {})
        }
        return await fake.fetch(input, init)
      }
      let completed = false
      const running = runHostedCrud(project, { ...terminal, ...fake, fetch }).then(() => (completed = true))
      await until(() => terminal.outputText().includes('Actions:'))
      terminal.input.write('r')
      await until(() => reloadStarted)
      terminal.input.write('qq')
      await until(() => completed)
      await running
      const output = terminal.outputText()
      Expect(reloadAborted).toBe(true)
      Expect(fake.stops()).toBe(1)
      Expect(output).toContain('Metro stopped.')
      Expect(output.slice(output.indexOf('Shutting down…'))).not.toContain('Reloading connected apps.')
    } finally {
      await FS.remove(root)
    }
  })

  Test('starts Metro without opening a simulator, then opens iOS on i', async () => {
    const root = await mkTestDir('tao-connect-run-simulator-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })
      await until(() => terminal.outputText().includes('Actions:'))
      Expect(fake.requests).not.toContain('POST /_expo/open?platform=ios')
      terminal.input.write('i')
      await until(() => terminal.outputText().includes('Opened Expo Go in the iOS Simulator.'))
      terminal.input.write('q')
      await running
      Expect(calls).toEqual([])
      Expect(fake.requests).toContain('POST /_expo/open?platform=ios')
      Expect(terminal.outputText()).not.toContain('To run on your iPhone:')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports Expo CLI output when Metro stops before it answers', async () => {
    const root = await mkTestDir('tao-connect-run-exit-')
    try {
      const project = await expoProject(root)
      const { runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      const terminal = fakeTerminal()
      const fake = fakeMetro([], { exitCode: 1 })
      await Expect(runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })).rejects.toThrow(
        /Expo CLI stopped with code 1\.[\s\S]*port 8081 is busy/u,
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test('shows physical-device sign-in guidance only on d without running login', async () => {
    const root = await mkTestDir('tao-connect-run-android-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 1, stdout: 'Not logged in\n' }])
      const terminal = fakeTerminal()
      const fake = fakeMetro([])
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })
      await until(() => terminal.outputText().includes('Actions:'))
      Expect(calls).toEqual([])
      Expect(terminal.outputText()).not.toContain('expo login')
      terminal.input.write('d')
      await until(() => terminal.outputText().includes('sign in to Expo CLI with `expo login`'))
      terminal.input.write('q')
      await running
      Expect(calls).toEqual(['whoami'])
      Expect(terminal.outputText()).toContain('Expo Go address:')
    } finally {
      await FS.remove(root)
    }
  })

  Test('prints ./tao inside a Tao development checkout and tao elsewhere', async () => {
    const root = await mkTestDir('tao-connect-run-command-')
    try {
      const project = await expoProject(root)
      Expect(await hostedCrudRunCommand('/no-tao-checkout/My App')).toBe("tao connect run '/no-tao-checkout/My App'")
      await FS.writeText(FS.resolvePath('tao', root), '#!/bin/sh\n')
      await FS.writeText(FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', root), '')
      Expect(await hostedCrudRunCommand(project)).toBe("./tao connect run 'Apps/Hosted CRUD'")
    } finally {
      await FS.remove(root)
    }
  })
})
