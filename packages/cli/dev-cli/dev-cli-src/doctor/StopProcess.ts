import { Errors, Platform, ProcessTree, Time, type TrackedProcess } from '@shared'

type Seams = {
  identity: (pid: number) => TrackedProcess | undefined
  group: (pid: number) => number | undefined
  members: (group: number) => TrackedProcess[]
  descendants: (pid: number) => TrackedProcess[]
  signal: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
  wait: (ms: number) => Promise<void>
}

/** Explicit recovery for a reviewed, isolated process. Never discovers targets by command name. */
export async function stopProcess(pid: number, startedAt: string, seams: Seams = {
  identity: pid => ProcessTree.identities([pid]).get(pid),
  group: ProcessTree.processGroupOf,
  members: ProcessTree.groupMembers,
  descendants: ProcessTree.descendants,
  signal: (pid, signal) => {
    Platform.signalProcess(pid, signal)
  },
  wait: Time.sleep,
}): Promise<void> {
  if (
    !Number.isSafeInteger(pid) || pid <= 1 || pid > 2_147_483_647
    || pid === Platform.runtimeProcess.pid || pid === Platform.runtimeProcess.ppid
    || !/^\d+(?::\d+)?$/u.test(startedAt) || startedAt.length > 40
  ) {
    Errors.throwUserInput('Expected a reviewed PID and its exact kernel start identity.')
  }
  const live = () => {
    const current = seams.identity(pid)
    if (current !== undefined && current.startedAt !== startedAt) {
      Errors.throwHostEnvironment(`PID ${pid} was reused; refusing to signal its new owner.`)
    }
    return current !== undefined
  }
  const exited = () => {
    if (live()) {
      return false
    }
    if (seams.members(pid).length > 0) {
      Errors.throwHostEnvironment(`PID ${pid} exited with process group members remaining; tree absence is unproved.`)
    }
    return true
  }
  if (exited()) {
    return
  }
  const isolated = () => {
    if (
      seams.group(pid) !== pid || seams.members(pid).some(member => member.pid !== pid)
      || seams.descendants(pid).length !== 0
    ) {
      Errors.throwHostEnvironment(`PID ${pid} is not an isolated process; use its owning lifecycle to stop the tree.`)
    }
  }
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    isolated()
    if (exited()) {
      return
    }
    seams.signal(pid, signal)
    // No unbounded join: denied signals and a process that survives KILL report failure.
    for (let attempt = 0; attempt < (signal === 'SIGTERM' ? 10 : 40); attempt++) {
      if (exited()) {
        return
      }
      await seams.wait(25)
    }
  }
  if (!exited()) {
    Errors.throwHostEnvironment(`PID ${pid} survived TERM and KILL; process absence is unproved.`)
  }
}
