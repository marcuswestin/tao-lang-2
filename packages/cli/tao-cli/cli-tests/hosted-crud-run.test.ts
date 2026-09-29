import { Errors, FS, Time } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import type { MetroStarter } from '../cli-src/hosted-crud-metro'
import { hostedCrudRunCommand, runHostedCrud } from '../cli-src/hosted-crud-run'

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
function fakeMetro(events: object[], options: { exitCode?: number } = {}) {
  const requests: string[] = []
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
      stop: async () => finish(null),
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
  return { fetch, metro, pollMs: 5, requests, started: () => started }
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
  {
    type: 'bundling_error',
    error: { message: 'SyntaxError: Unexpected token (3:4)', filename: 'src/App.tsx', lineNumber: 3, column: 4 },
  },
  { type: 'client_log', level: 'warn', data: ['hello', { id: 1 }] },
]

Describe('tao connect run', () => {
  Test('signs Expo CLI in, then shows Expo address, bundling, errors and logs on its own screen', async () => {
    const root = await mkTestDir('tao-connect-run-login-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([
        { exitCode: 1, stdout: 'Not logged in\n' },
        { exitCode: 0, stdout: '\u001b[32mdev-user\u001b[39m\n' },
      ])
      const terminal = fakeTerminal('yes\n')
      const fake = fakeMetro(bundleEvents)
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })
      await until(() => terminal.outputText().includes('app warn:'))
      terminal.input.write('r')
      await until(() => fake.requests.includes('GET /message?method=reload'))
      terminal.input.write('q')
      await running

      const output = terminal.outputText()
      Expect(calls).toEqual(['whoami', 'login', 'whoami'])
      Expect(fake.started()?.args.slice(2)).toEqual([
        FS.resolvePath('node_modules/.bin/expo', root),
        'start',
        '--go',
        '--port',
        '8081',
      ])
      Expect(output).toContain('Expo CLI is signed in as dev-user.')
      Expect(output).toContain(
        'open the Home tab, tap the account icon at the top right, and sign in as dev-user.',
      )
      Expect(output).toContain('exp://192.168.1.5:8081')
      Expect(output).toContain('Scan the code with the iPhone camera')
      Expect(output).toContain('iOS: bundling 25% (50/200 files)')
      Expect(output).toMatch(/iOS bundled in [\d.]+s \(200 files\)/u)
      Expect(output).toContain('Bundling failed in src/App.tsx:3:4.')
      Expect(output).toContain('SyntaxError: Unexpected token (3:4)')
      Expect(output).toContain('hello {"id":1}')
      Expect(output).toContain('Reloading connected apps.')
      Expect(output).toContain('Stopped Metro.')
      Expect(fake.requests).not.toContain('POST /_expo/open?platform=ios')
      Expect(await FS.exists(FS.resolvePath('.tao/connect-run/expo.log', project))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('opens the iOS Simulator when Return skips the iPhone sign-in wait', async () => {
    const root = await mkTestDir('tao-connect-run-simulator-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      const terminal = fakeTerminal('maybe\n\n')
      const fake = fakeMetro([])
      const running = runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })
      await until(() => terminal.outputText().includes('Opened Expo Go in the iOS Simulator.'))
      terminal.input.write('q')
      await running
      Expect(calls).toEqual(['whoami'])
      Expect(fake.requests).toContain('POST /_expo/open?platform=ios')
      Expect(terminal.outputText()).toContain('Type yes, or press Return.')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports Expo CLI output when Metro stops before it answers', async () => {
    const root = await mkTestDir('tao-connect-run-exit-')
    try {
      const project = await expoProject(root)
      const { runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      const terminal = fakeTerminal('yes\n')
      const fake = fakeMetro([], { exitCode: 1 })
      await Expect(runHostedCrud(project, { ...terminal, ...fake, expoRunner: runner })).rejects.toThrow(
        /Expo CLI stopped with code 1\.[\s\S]*port 8081 is busy/u,
      )
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
