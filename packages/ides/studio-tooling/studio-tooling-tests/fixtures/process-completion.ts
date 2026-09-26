/** Real children with only aggregate close suppressed; module replacement stays in this subprocess. */
import { Assert, FS, HCI, Platform, Switch } from '@shared'
import { MockModule, settle, until } from '@shared/test'

const original = { ...Platform }
const nativeSpawn = Platform.spawn
const mode = Platform.runtimeProcess.argv[2]!
const root = Platform.runtimeProcess.argv[3]!
const releasePath = FS.resolvePath('release', root)
const artifacts: string[] = []
const children: { child: ReturnType<typeof nativeSpawn>; exited: boolean; suppressed: number }[] = []
MockModule(new URL('../../../../shared/shared-src/Platform.ts', import.meta.url).pathname, () => ({
  ...original,
  spawn(command: string, options: Platform.SpawnOptions = {}) {
    const artifactIndex = options.args?.indexOf('--journey-observations') ?? -1
    if (artifactIndex >= 0) {
      artifacts.push(options.args![artifactIndex + 1]!)
    }
    const child = nativeSpawn(command, options)
    const record = { child, exited: false, suppressed: 0 }
    children.push(record)
    child.once('exit', () => {
      record.exited = true
    })
    const emit = child.emit.bind(child)
    child.emit = (event: string | symbol, ...args: unknown[]) => {
      // A failed spawn has no exit notification, so its native close remains authoritative.
      if (event === 'close' && child.pid !== undefined) {
        record.suppressed++
        return false
      }
      return emit(event, ...args)
    }
    return child
  },
}))
const { CLI } = await import('@shared')
const { StudioTestProcessRunner } = await import('../../studio-tooling-src/StudioTestProcessRunner')
const { startStudioProcessTree } = await import('@expo-host/dev-loop/StudioProcessTree')

function groupExists(pid: number): boolean {
  return original.spawnSync('/bin/kill', { args: ['-0', '--', `-${pid}`], stdio: 'ignore' }).status === 0
}
function cleanup(): void {
  for (const { child } of children) {
    if (child.pid !== undefined && groupExists(child.pid)) {
      original.spawnSync('/bin/kill', { args: ['-KILL', '--', `-${child.pid}`], stdio: 'ignore' })
    }
    child.stdin?.destroy()
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
  for (const path of [releasePath, ...artifacts]) {
    FS.removeSync(path)
  }
}
const deadline = setTimeout(() => {
  cleanup()
  HCI.writeErrorLine('Native process completion fixture exceeded its 30-second bound.')
  Platform.runtimeProcess.exit(124)
}, 30_000)
const shell =
  `printf 'head\n'; printf 'errhead\n' >&2; (while [ ! -f "$1" ]; do sleep 0.01; done; printf 'tail\n'; printf 'errtail\n' >&2) & exit 0`
const args = ['-c', shell, 'completion-fixture', releasePath]
const artifact = { checks: [], format: 'tao-journey-observations', version: 1 }
async function exitedWithOpenPipes(): Promise<void> {
  const record = children.at(-1)!
  await until(() => record.exited, { description: 'the real shell to exit before its descendant' })
  await settle()
  Assert(!record.child.stdout!.closed && !record.child.stderr!.closed, 'Descendant still owns both output pipes.')
}
async function release(): Promise<void> {
  await FS.writeText(releasePath, '')
}
try {
  await Switch(mode, {
    async cli() {
      let settled = false
      const pending = CLI.run('/bin/sh', { args, detached: true }).then(result => {
        settled = true
        return result
      })
      await exitedWithOpenPipes()
      Assert(!settled, 'CLI must wait for descendant output after parent exit.')
      await release()
      const result = await pending
      Assert(result.exitCode === 0, 'CLI preserves the exit code.')
      Assert(
        result.stdout === 'head\ntail\n' && result.stderr === 'errhead\nerrtail\n',
        'CLI preserves both complete tails.',
      )
    },
    async studio() {
      const runner = new StudioTestProcessRunner({
        args: ['-c', `printf '%s' '${JSON.stringify(artifact)}' > "$3"; ${shell}`, 'completion-fixture', releasePath],
        command: '/bin/sh',
        cwd: root,
      })
      let settled = false
      const pending = runner.run().then(result => {
        settled = true
        return result
      })
      await exitedWithOpenPipes()
      Assert(!settled, 'Studio must wait for descendant output after parent exit.')
      await release()
      const result = await pending
      Assert(
        result.output.split('\n').sort().join(',') === 'errhead,errtail,head,tail',
        'Studio preserves both complete tails.',
      )
      Assert(
        JSON.stringify(runner.journeyObservations()) === JSON.stringify(artifact),
        'Studio retains the versioned artifact.',
      )
      await runner.close()
    },
    async exit() {
      const output: string[] = []
      const tree = startStudioProcessTree('/bin/sh', {
        args,
        settleOnExit: true,
        onOutput: (_stream, chunk) => output.push(chunk.toString()),
      })
      const closed = new Promise(resolve => tree.onceClose(resolve))
      Assert((await tree.waitForClose()).exitCode === 0, 'Exit-only mode reports the real exit.')
      await exitedWithOpenPipes()
      await release()
      await closed
      Assert(
        output.join('').trim().split('\n').sort().join(',') === 'errhead,errtail,head,tail',
        'The close observer waits for both tails.',
      )
      await tree.closeOutput()
      tree.dispose()
    },
    async stdio() {
      for (const stdio of ['ignore', 'inherit'] as const) {
        const result = await CLI.run('/bin/sh', { args: ['-c', 'exit 7'], detached: true, stdio })
        Assert(
          result.exitCode === 7 && result.stdout === '' && result.stderr === '',
          'Uncaptured output preserves completion.',
        )
      }
      const failure = await CLI.run(FS.resolvePath('nonexistent-command', root), { detached: true })
      Assert(failure.error !== undefined && failure.exitCode !== 0, 'A failed spawn completes with its native error.')
    },
  })
  await settle()
  Assert(
    children.filter(({ child }) => child.pid !== undefined).every(record => record.suppressed === 1),
    'Every real aggregate close was suppressed.',
  )
  await until(() => children.every(({ child }) => child.pid === undefined || !groupExists(child.pid)), {
    description: 'all owned process groups to exit',
  })
  HCI.writeLine(JSON.stringify({ mode, ownedGroupsGone: true }))
} finally {
  clearTimeout(deadline)
  cleanup()
}
