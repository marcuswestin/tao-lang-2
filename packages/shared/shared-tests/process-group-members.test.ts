import { CLI, Errors, Platform, ProcessTree } from '@shared'
import { Expect, Test, until } from '@shared/test'

Test('kernel group inspection retains exact identity of an orphaned owned descendant', async () => {
  let childPid: number | undefined
  const root = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      '--eval',
      `const child = Bun.spawn({cmd:[process.execPath,'--eval','setInterval(() => {}, 1000)'],stdout:'ignore',stderr:'ignore'});console.log(child.pid);setInterval(() => {}, 1000);`,
    ],
    detached: true,
    processPolicy: 'server',
    stdio: 'pipe',
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') {
        childPid = Number(chunk.toString('utf8').trim())
      }
    },
  })
  let tracked: ReturnType<typeof ProcessTree.groupMembers> = []
  let childIdentity: ReturnType<typeof ProcessTree.groupMembers>[number] | undefined
  try {
    await until(() => childPid !== undefined && childPid > 0 ? true : undefined, {
      description: 'owned group child publication',
    })
    childIdentity = ProcessTree.identities([childPid!]).get(childPid!)
    tracked = ProcessTree.groupMembers(root.pid!)
    Expect(tracked.map(process => process.pid).sort((a, b) => a - b)).toEqual(
      [root.pid!, childPid!].sort((a, b) => a - b),
    )
    const child = tracked.find(process => process.pid === childPid)!
    Expect(ProcessTree.identities([child.pid]).get(child.pid)?.startedAt).toBe(child.startedAt)
    root.kill('SIGTERM')
    await root.waitForClose()
    Expect(ProcessTree.groupMembers(root.pid!).map(process => process.pid)).toEqual([child.pid])
    ProcessTree.signalTracked([child], 'SIGKILL')
    await until(() => ProcessTree.groupMembers(root.pid!).length === 0 ? true : undefined, {
      description: 'owned group descendant exit',
    })
    Expect(ProcessTree.isGroupAlive(root.pid!)).toBe(false)
  } finally {
    root.kill('SIGKILL')
    ProcessTree.signalTracked(tracked, 'SIGKILL')
    if (childIdentity !== undefined) {
      ProcessTree.signalTracked([childIdentity], 'SIGKILL')
    }
    await root.waitForClose()
    await root.closeOutput()
    root.dispose()
  }
})

Test('group inspection refuses invalid group identifiers', () => {
  Expect(() => ProcessTree.groupMembers(0)).toThrow('valid process group')
})

Test('group liveness never turns a denied kernel probe into evidence of group absence', () => {
  Expect(() =>
    ProcessTree.isGroupAlive(987, (pid, signal) => {
      Expect(pid).toBe(-987)
      Expect(signal).toBe(0)
      return Errors.throwHostEnvironment('kernel probe denied')
    }, { platform: 'darwin' })
  ).toThrow('kernel probe denied')
  Expect(ProcessTree.isGroupAlive(987, () => false, { platform: 'darwin' })).toBe(false)
})
