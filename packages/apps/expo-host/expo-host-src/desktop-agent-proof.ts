import { Assert, CLI, Errors, FS, HCI, Platform, ProjectLocal, Repo, Time } from '@shared'
import { withDesktopAgentProofProfile } from './desktop-agent-proof-profile'
import { DesktopHost } from './desktop-host'

/** Real packaged macOS proof; reached only through the explicit host-testing lane. */
export async function proveDesktopAgent(): Promise<void> {
  Assert.input(Platform.hostPlatform === 'darwin', 'The background app proof requires macOS.')
  const id = Platform.randomUUID()
  const root = Repo.resolvePath(`.artifacts/scratch/background-app-rpc/${id}`)
  await FS.mkdir(root)
  await provePing(id, root)
  await proveCommands(id, root)
}

async function provePing(id: string, root: string): Promise<void> {
  const stateRoot = FS.resolvePath('state', root)
  const project = await DesktopHost.prepare({
    appName: `Tao RPC Proof ${id.slice(0, 8)}`,
    root: FS.resolvePath('host', root),
    agents: { buildId: id },
  })
  const app = await DesktopHost.build(project)
  const env = { ...Platform.runtimeProcess.env, TAO_AGENT_STATE_ROOT: stateRoot }
  const before = await desktopState()
  let started = false
  async function client(action: string): Promise<Record<string, unknown>> {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [Repo.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts'), 'agents', action, '--app', app],
      env,
      processPolicy: 'test',
      timeoutMs: 60_000,
    })
    await FS.writeJson(FS.resolvePath(`${action}.json`, root), result)
    Assert(result.exitCode === 0, `packaged app ${action} succeeds`, { stderr: result.stderr, stdout: result.stdout })
    const value = JSON.parse(result.stdout) as { ok: boolean; result: Record<string, unknown> }
    Assert(value.ok, `packaged app ${action} returns success`, { value })
    return value.result
  }
  try {
    started = true
    await client('start')
    const pong = await client('ping')
    Assert(pong['message'] === 'pong' && pong['buildId'] === id, 'ping reaches the packaged build', { pong })
    const after = await desktopState()
    Assert(before.frontmost === after.frontmost, 'background launch leaves focus unchanged', { before, after })
    Assert(
      !after.windowPids.includes(Number(pong['pid'])) && !after.windowPids.includes(Number(pong['launcherPid'])),
      'background launch creates no onscreen windows',
      { after, pong },
    )
    await client('stop')
    started = false
    await FS.writeJson(FS.resolvePath('proof.json', root), { app, before, after, pong, passed: true })
    HCI.writeLine(`Packaged background ping-pong proved: ${root}`)
  } finally {
    if (started) {
      await client('stop').catch(error => HCI.writeErrorLine(Errors.messageOf(error)))
    }
  }
}

type CommandMetadata = {
  id: string
  name: string
  parameters: { name: string; type: string; required: boolean }[]
  enabled?: boolean
}
type ClientReply = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }

async function proveCommands(id: string, root: string): Promise<void> {
  const fixture = FS.resolvePath('fixture', root)
  await FS.copyDirectory(Repo.resolvePath('Apps/Test Apps/Agent Commands'), fixture)
  const appName = `AgentCommandsProof${id.replaceAll('-', '')}`
  for (const file of ['Agent Commands.tao', 'Agent Commands.test.tao']) {
    const source = FS.resolvePath(file, fixture)
    await FS.writeText(source, (await FS.readText(source)).replaceAll('AgentCommandsProof', appName))
  }
  const stateRoot = FS.resolvePath('command-state', root)
  const env: Platform.ProcessEnv = { ...Platform.runtimeProcess.env, TAO_AGENT_STATE_ROOT: stateRoot }
  delete env['TAO_AGENT_MODE']
  const cli = Repo.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts')
  const build = await CLI.run(Platform.runtimeProcess.execPath, {
    args: [cli, 'build', fixture, '--agents', '--app', appName],
    env,
    processPolicy: 'test',
    timeoutMs: 360_000,
  })
  await FS.writeJson(FS.resolvePath('command-build.json', root), build)
  Assert(build.exitCode === 0, 'the Local fixture builds as a real static packaged app', { build })
  const buildsRoot = ProjectLocal.storeResolve('builds', fixture)
  const records = (await FS.listDir(buildsRoot)).filter(name => !name.startsWith('.') && name !== 'agents')
  Assert(records.length === 1, 'the isolated fixture has exactly one build record', { records })
  const record = await FS.readJson<{
    appName: string
    id: string
    results: { desktop?: { artifact: string; status: string } }
  }>(FS.resolvePath(`${records[0]}/build.json`, buildsRoot))
  Assert(
    record.appName === appName && record.results.desktop?.status === 'succeeded',
    'the expected app was packaged',
    { record },
  )
  const app = record.results.desktop.artifact
  const manifest = await FS.readJson<{ appId: string }>(FS.resolvePath('Contents/Resources/app/tao-agent.json', app))
  const profilePath = await withDesktopAgentProofProfile({ appId: manifest.appId, proofId: id }, async profile => {
    let requestIndex = 0
    let started = false
    let visible: CLI.StartedCommand | undefined
    async function request(action: string, invocation?: { commandId: string; args: unknown }): Promise<ClientReply> {
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [
          cli,
          'agents',
          action,
          ...(action === 'commands' ? ['--json'] : []),
          ...(invocation ? [invocation.commandId, '--args', JSON.stringify(invocation.args)] : []),
          '--app',
          app,
        ],
        env,
        processPolicy: 'test',
        timeoutMs: 60_000,
      })
      await FS.writeJson(FS.resolvePath(`command-${++requestIndex}-${action}.json`, root), result)
      const value = JSON.parse(result.stdout) as ClientReply
      Assert(result.exitCode === (value.ok ? 0 : 1), 'the client exit status agrees with its structured outcome', {
        result,
      })
      return value
    }
    async function success(action: string, invocation?: { commandId: string; args: unknown }): Promise<unknown> {
      const value = await request(action, invocation)
      Assert(value.ok, `packaged command app ${action} succeeds`, { value })
      return value.result
    }
    async function bundled(args: string[]): Promise<unknown> {
      const result = await CLI.run(FS.resolvePath('agents', buildsRoot), {
        args,
        env,
        processPolicy: 'test',
        timeoutMs: 60_000,
      })
      await FS.writeJson(FS.resolvePath(`command-${++requestIndex}-bundled.json`, root), result)
      const value = JSON.parse(result.stdout) as ClientReply
      Assert(result.exitCode === 0 && value.ok, 'the bundled client completes a separate invocation', { args, result })
      return value.result
    }
    async function discover(): Promise<CommandMetadata[]> {
      let commands: CommandMetadata[] | undefined
      let last: ClientReply | undefined
      // Discovery is read-only and may wait for the lazy renderer. Execution is never retried.
      const ready = await Time.pollUntil(async () => {
        last = await request('commands')
        if (last.ok) {
          commands = last.result as CommandMetadata[]
        }
        return commands !== undefined
      }, { timeoutMs: 30_000, intervalMs: 250 })
      Assert(ready && commands !== undefined, 'the packaged renderer discovers app commands', { last })
      return commands
    }
    async function invoke(command: CommandMetadata, args: unknown): Promise<void> {
      const receipt = await success('run', { commandId: command.id, args }) as { commandId: string; outcome: string }
      Assert(
        receipt.commandId === command.id && receipt.outcome === 'committed',
        'the command reports its committed outcome',
        { receipt },
      )
    }
    const before = await desktopState()
    try {
      started = true
      const pong = await success('start') as Record<string, unknown>
      Assert(
        pong['buildId'] === record.id && pong['renderer'] === 'absent',
        'background startup is lazy and identifies this build',
        { pong },
      )
      const commands = await discover()
      profile.track([Number(pong['pid']), Number(pong['launcherPid'])])
      Assert(
        commands.length === 3 && !commands.some(command => command.name === 'UnlistedEntry'),
        'only the explicit allowlist is exposed',
        { commands },
      )
      const append = commands.find(command => command.name === 'AppendEntry')
      const verify = commands.find(command => command.name === 'VerifyEntries')
      const disabled = commands.find(command => command.name === 'DisabledEntry')
      Assert(append && verify && disabled, 'all three fixture commands are discoverable', { commands })
      const expectedParameters = [
        { name: 'Message', type: 'text', required: true },
        { name: 'Quantity', type: 'number', required: false },
        { name: 'Marked', type: 'boolean', required: false },
      ]
      Assert(
        append.parameters.length === expectedParameters.length && append.parameters.every((parameter, index) => {
          const expected = expectedParameters[index]!
          return parameter.name === expected.name && parameter.type === expected.type
            && parameter.required === expected.required
        }),
        'discovery describes scalar argument names and types',
        { append },
      )
      Assert(disabled.enabled === false, 'discovery reports the disabled command', { disabled })
      const discoveredState = await desktopState()
      Assert(
        before.frontmost === discoveredState.frontmost
          && !discoveredState.windowPids.includes(Number(pong['pid']))
          && !discoveredState.windowPids.includes(Number(pong['launcherPid'])),
        'lazy command discovery leaves focus and onscreen windows unchanged',
        { before, discoveredState, pong },
      )
      const values = { Message: `Hidden append ${id}`, Quantity: 37, Marked: true }
      HCI.writeLine('Leaving the hidden command app idle for 45 seconds before the next request…')
      await Time.sleep(45_000)
      const afterIdle = await bundled(['commands', '--json']) as CommandMetadata[]
      Assert(afterIdle.some(command => command.id === append.id), 'discovery still responds after hidden idle')
      await invoke(verify, { ...values, Count: 0 })
      const refusal = await request('run', { commandId: disabled.id, args: {} })
      Assert(!refusal.ok && refusal.error.code === 'command_rejected', 'disabled execution is rejected', { refusal })
      HCI.writeLine('Leaving the hidden app idle again before a separate bundled run…')
      await Time.sleep(45_000)
      await bundled(['run', 'AppendEntry', '--args', JSON.stringify({ Message: values.Message })])
      await invoke(verify, { ...values, Count: 1 })
      const failure = await request('run', { commandId: verify.id, args: { ...values, Count: 2 } })
      Assert(!failure.ok && failure.error.code === 'failed', 'an action failure is a structured failed outcome', {
        failure,
      })
      const after = await desktopState()
      Assert(before.frontmost === after.frontmost, 'discovery and command execution leave focus unchanged', {
        before,
        after,
      })
      Assert(
        !after.windowPids.includes(Number(pong['pid'])) && !after.windowPids.includes(Number(pong['launcherPid'])),
        'discovery and command execution create no onscreen windows',
        { after, pong },
      )
      await bundled(['run', 'VerifyEntries', '--args', JSON.stringify({ ...values, Count: 1 }), '--stop-after'])
      started = false
      const stopped = await request('ping')
      Assert(!stopped.ok && stopped.error.code === 'not_running', 'stop retires the background service', { stopped })
      const executable = await CLI.run('/usr/bin/plutil', {
        args: ['-extract', 'CFBundleExecutable', 'raw', FS.resolvePath('Contents/Info.plist', app)],
        processPolicy: 'test',
      })
      const executableName = executable.stdout.trim()
      Assert(
        executable.exitCode === 0 && FS.basename(executableName) === executableName,
        'the visible app executable is declared',
        { executable },
      )
      const log = await FS.openAppend(FS.resolvePath('visible-launch.log', root))
      try {
        visible = CLI.start(FS.resolvePath(`Contents/MacOS/${executableName}`, app), {
          cwd: app,
          env,
          processPolicy: 'server',
          stdio: ['ignore', log.fd, log.fd],
        })
        started = true
      } finally {
        await log.close()
      }
      const relaunchedCommands = await discover()
      Assert(
        JSON.stringify(relaunchedCommands.map(command => command.id))
          === JSON.stringify(commands.map(command => command.id)),
        'canonical command identities survive a visible relaunch',
        { commands, relaunchedCommands },
      )
      await invoke(verify, { ...values, Count: 1 })
      const visiblePong = await success('ping') as Record<string, unknown>
      profile.track([Number(visiblePong['pid']), Number(visiblePong['launcherPid'])])
      Assert(visiblePong['instanceId'] !== pong['instanceId'], 'persistence was read by a new app instance', {
        pong,
        visiblePong,
      })
      let visibleState = await desktopState()
      const shown = await Time.pollUntil(async () => {
        visibleState = await desktopState()
        return visibleState.windowPids.includes(Number(visiblePong['pid']))
          || visibleState.windowPids.includes(Number(visiblePong['launcherPid']))
      }, { timeoutMs: 30_000, intervalMs: 100 })
      Assert(shown, 'the normal relaunch owns an onscreen window', { visibleState, visiblePong })
      Assert(await FS.isDirectory(profile.path), 'the real WebKit acceptance profile was created', {
        path: profile.path,
      })
      await success('stop')
      started = false
      await FS.writeJson(FS.resolvePath('command-proof.json', root), {
        app,
        record,
        commands,
        before,
        discoveredState,
        after,
        visibleState,
        pong,
        visiblePong,
        persistedValues: values,
        persistedCount: 1,
        passed: true,
      })
      HCI.writeLine(`Packaged Local command and visible-relaunch persistence proved: ${root}`)
    } finally {
      if (started) {
        await success('stop').catch(error => HCI.writeErrorLine(Errors.messageOf(error)))
      }
      visible?.dispose()
    }
  })
  await FS.writeJson(FS.resolvePath('profile-cleanup.json', root), { profilePath, removed: true })
  HCI.writeLine(`Removed successful acceptance WebKit profile: ${profilePath}`)
}

async function desktopState(): Promise<{ frontmost: number; windowPids: number[] }> {
  const script = [
    "ObjC.import('AppKit'); ObjC.import('CoreGraphics');",
    'JSON.stringify({frontmost:Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),',
    'windowPids:ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1,0))).map(w => Number(w.kCGWindowOwnerPID))})',
  ].join('\n')
  const result = await CLI.run('/usr/bin/osascript', {
    args: ['-l', 'JavaScript', '-e', script],
    processPolicy: 'test',
  })
  Assert(result.exitCode === 0, 'macOS can report foreground app and onscreen window owners', { stderr: result.stderr })
  return JSON.parse(result.stdout)
}
