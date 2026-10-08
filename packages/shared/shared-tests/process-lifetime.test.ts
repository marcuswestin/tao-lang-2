import { CLI, FS, Platform, ProcessLifetime, ProcessTree, type TrackedProcess } from '@shared'
import { Describe, Expect, Test, until } from '@shared/test'

function alive(tracked: TrackedProcess): boolean {
  return ProcessTree.sameProcess(ProcessTree.identities([tracked.pid]).get(tracked.pid), tracked)
}

Describe('process lifetime', () => {
  Test('a linked child dies when its parent is killed without warning', async () => {
    let published: { linked: TrackedProcess; plain: TrackedProcess } | undefined
    let stdout = ''
    const parent = CLI.start(Platform.runtimeProcess.execPath, {
      args: [FS.resolvePath('fixtures/process-lifetime-parent.ts', import.meta.dir)],
      processPolicy: 'server',
      stdio: 'pipe',
      onOutput: (stream, chunk) => {
        if (stream === 'stdout') {
          stdout += chunk.toString('utf8')
          const line = stdout.split('\n')[0]
          if (stdout.includes('\n') && line !== undefined) {
            published = JSON.parse(line)
          }
        }
      },
    })
    try {
      const identities = await until(() => published, { description: 'fixture child identities' })
      Expect(alive(identities.linked)).toBe(true)
      Expect(alive(identities.plain)).toBe(true)

      parent.kill('SIGKILL')
      await parent.waitForClose()

      await until(() => alive(identities.linked) ? undefined : true, {
        description: 'linked child exit after parent SIGKILL',
        intervalMs: 50,
        timeoutMs: 10_000,
      })
      // The link stops its own group and nothing else: the plain sibling is still running.
      Expect(alive(identities.plain)).toBe(true)
      ProcessTree.signalTracked([identities.plain], 'SIGKILL')
      await until(() => alive(identities.plain) ? undefined : true, { description: 'plain child exit' })
      // The watcher outlives the child by the kill grace before it sweeps its group and exits.
      await until(() => ProcessTree.isGroupAlive(identities.linked.pid) ? undefined : true, {
        description: 'linked watcher exit after its group is gone',
        intervalMs: 50,
        timeoutMs: 10_000,
      })
    } finally {
      parent.kill('SIGKILL')
      await parent.waitForClose().catch(() => undefined)
      if (published !== undefined) {
        ProcessTree.signalTracked([published.linked, published.plain], 'SIGKILL')
      }
    }
  })

  Test('a linked child inherits no end of the link', async () => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', '(: >&3) 2>/dev/null && echo open || echo closed'],
      lifetime: 'dies-with-parent',
    })
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout.trim()).toBe('closed')
  })

  Test('a linked child keeps its exit code and its arguments', async () => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', 'echo "$1:$2"; exit 7', 'argv0', 'first', 'second word'],
      lifetime: 'dies-with-parent',
    })
    Expect(result.exitCode).toBe(7)
    Expect(result.stdout.trim()).toBe('first:second word')
  })

  Test('a linked child that exits on its own releases its watcher', async () => {
    const child = CLI.start('/bin/sh', {
      args: ['-c', 'exit 0'],
      lifetime: 'dies-with-parent',
      stdio: 'ignore',
    })
    const pid = child.pid!
    const close = await child.waitForClose()
    Expect(close.exitCode).toBe(0)
    await until(() => ProcessTree.isGroupAlive(pid) ? undefined : true, {
      description: 'watcher exit after release',
      intervalMs: 20,
    })
  })

  Test('a linked child is admitted before anything of it runs', async () => {
    Expect(ProcessLifetime.EXIT_CODES.admissionRefused).toBe(70)
    const result = await CLI.run('/bin/sh', {
      args: ['-c', `IFS= read -r admission <&3 || exit ${ProcessLifetime.EXIT_CODES.admissionRefused}; exit 3`],
      lifetime: 'dies-with-parent',
    })
    // Descriptor 3 is closed for the child, so its own read fails: the admission already happened.
    Expect(result.exitCode).toBe(ProcessLifetime.EXIT_CODES.admissionRefused)
  })

  Test('a child released from the event loop must record why it outlives its parent', () => {
    Expect(() => CLI.start('/bin/true', { stdio: 'ignore', unref: true })).toThrow(/outlivesParent/u)
    Expect(() => CLI.start('/bin/true', { lifetime: { outlivesParent: '  ' }, stdio: 'ignore', unref: true }))
      .toThrow(/reason/u)
    Expect(() => CLI.start('/bin/true', { lifetime: 'dies-with-parent', stdio: 'ignore', unref: true }))
      .toThrow(/outlivesParent/u)
  })

  Test('a linked child cannot carry IPC or extra descriptors', () => {
    Expect(() => ProcessLifetime.linkedStdio(['pipe', 'pipe', 'pipe', 'ipc'])).toThrow(/standard descriptors/u)
    Expect(() => ProcessLifetime.linkedStdio(['pipe', 'pipe', 'pipe', 'pipe'])).toThrow(/standard descriptors/u)
    Expect(ProcessLifetime.linkedStdio('ignore')).toEqual(['ignore', 'ignore', 'ignore', 'pipe'])
    Expect(ProcessLifetime.linkedStdio(['inherit'])).toEqual(['inherit', 'pipe', 'pipe', 'pipe'])
  })
})
