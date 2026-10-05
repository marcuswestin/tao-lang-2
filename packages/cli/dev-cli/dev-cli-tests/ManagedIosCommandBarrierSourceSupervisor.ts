import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import {
  managedIosBarrierControlPrefix,
  managedIosCommandArguments,
  type ManagedIosCommandPlan,
} from '../dev-cli-src/dev-loop/ManagedIosCommandBarrier'

function failSupervisor(message: string): never {
  return Errors.throwHostEnvironment(message)
}

const [planPath, mode, extra] = Platform.runtimeProcess.argv.slice(2)
if (
  !planPath || extra
  || !['short', 'hold', 'nonzero', 'escape', 'metadata', 'fixed-result', 'refuse-worker-ack', 'reject-worker-close']
    .includes(
      mode ?? '',
    )
) {
  Errors.throwUserInput('The private iOS supervisor accepts one owned fixed command plan.')
}
const plan = await FS.readJson<ManagedIosCommandPlan>(planPath)
managedIosCommandArguments(plan)
if (
  FS.dirname(planPath) !== plan.root || FS.basename(planPath) !== `command-${plan.generation}.json`
  || await FS.fileMode(planPath) !== 0o600 || await FS.fileMode(plan.root) !== 0o700
) {
  Errors.throwHostEnvironment('Private iOS command plan publication is not its exact private invocation file.')
}
let workerOutput = ''
const worker = CLI.start('/bin/bash', {
  args: [
    Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/ManagedIosCommandBarrierSourceWorker.sh'),
    plan.generation,
    plan.root,
    mode === 'refuse-worker-ack' || mode === 'reject-worker-close' ? 'short' : mode!,
    Platform.runtimeProcess.execPath,
    Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/ManagedIosCommandBarrierSourceChild.ts'),
  ],
  cwd: Repo.getRoot(),
  detached: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  processPolicy: 'server',
  onOutput: (stream, chunk) => {
    if (stream === 'stdout') {
      workerOutput = (workerOutput + chunk.toString('utf8')).slice(-4096)
    } else {
      Platform.runtimeProcess.stderr.write(chunk)
    }
  },
})
// Fixed source-only faults exercise supervisor refusal; production never accepts these modes.
if (mode === 'refuse-worker-ack') {
  worker.writeStdin = () => false
}
const originalClose = worker.waitForClose.bind(worker)
if (mode === 'reject-worker-close') {
  worker.waitForClose = async () => {
    await originalClose()
    return failSupervisor('Fixed source worker close observation rejected.')
  }
}
let closed: CLI.CommandCloseResult | undefined
let originalWorker: TrackedProcess | undefined
let input = ''
let released = false
let acknowledged = false
let cancelled = false
let eof = false
let refused = false
void worker.waitForClose().then(value => {
  closed = value
}, () => {
  refused = true
  closed = { exitCode: null, signal: null }
})
const cancel = () => {
  cancelled = true
  if (!released) {
    worker.endStdin()
  } else if (originalWorker) {
    ProcessTree.signalTracked([originalWorker], 'SIGTERM')
  }
}
Platform.runtimeProcess.stdin.setEncoding('utf8')
Platform.runtimeProcess.stdin.on('data', chunk => {
  input += chunk
  if (input.length > 256) {
    refused = true
    cancel()
    return
  }
  while (input.includes('\n')) {
    const end = input.indexOf('\n')
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (
      line === `run ${plan.generation}` && originalWorker && !released && !cancelled && !refused && closed === undefined
    ) {
      const current = ProcessTree.identities([originalWorker.pid]).get(originalWorker.pid)
      if (
        !current || current.pid !== originalWorker.pid || !ProcessTree.sameProcess(current, originalWorker)
        || ProcessTree.processGroupOf(originalWorker.pid) !== Platform.runtimeProcess.pid
      ) {
        refused = true
        cancel()
        continue
      }
      if (!worker.writeStdin(`execute ${plan.generation}\n`)) {
        refused = true
        cancel()
      } else {
        released = true
      }
    } else if (line === `cancel ${plan.generation}` && !acknowledged) {
      cancel()
    } else if (line === `finish ${plan.generation}` && closed !== undefined && !refused) {
      acknowledged = true
      Platform.runtimeProcess.stdin.pause()
    } else {
      refused = true
      cancel()
    }
  }
})
Platform.runtimeProcess.stdin.on('end', () => {
  eof = true
  cancel()
})
const ready = await Time.pollUntil(() => workerOutput.match(/^held (\d+) (\d+)\n/u), {
  intervalMs: 25,
  timeoutMs: 10_000,
})
if (!ready || !worker.pid || Number(ready[1]) !== worker.pid || Number(ready[2]) !== Platform.runtimeProcess.pid) {
  worker.endStdin()
  Platform.runtimeProcess.exit(72)
  failSupervisor('Private iOS held worker readiness is unproved.')
}
const capturedWorker = ProcessTree.identities([worker.pid]).get(worker.pid)
if (!capturedWorker) {
  worker.endStdin()
  Platform.runtimeProcess.exit(72)
  failSupervisor('Private iOS held worker kernel is unreadable.')
}
originalWorker = capturedWorker
const emit = (event: 'ready' | 'closed', result?: CLI.CommandCloseResult) =>
  Platform.runtimeProcess.stdout.write(
    `${managedIosBarrierControlPrefix}${
      JSON.stringify({
        event,
        generation: plan.generation,
        workerPid: worker.pid,
        workerParentPid: Number(ready[2]),
        result,
      })
    }\n`,
  )
emit('ready')
const result = await Time.pollUntil(() => closed, { intervalMs: 25, timeoutMs: plan.budgetMs })
if (!result) {
  cancel()
  // budget-ok: Model the production supervisor's fixed two-second TERM escalation interval.
  if (!await Time.pollUntil(() => closed, { intervalMs: 25, timeoutMs: 2_000 })) {
    ProcessTree.signalTracked([capturedWorker], 'SIGKILL')
    // budget-ok: Model the production supervisor's fixed two-second KILL join interval.
    if (!await Time.pollUntil(() => closed, { intervalMs: 25, timeoutMs: 2_000 })) {
      Platform.runtimeProcess.exit(73)
    }
  }
}
await worker.closeOutput()
worker.dispose()
emit('closed', closed)
if (eof || refused) {
  Platform.runtimeProcess.exit(72)
}
if (
  !await Time.pollUntil(() => acknowledged || eof || refused ? true : undefined, { intervalMs: 25, timeoutMs: 10_000 })
) {
  Platform.runtimeProcess.exit(74)
}
Platform.runtimeProcess.exit(acknowledged && !refused ? 0 : 72)
