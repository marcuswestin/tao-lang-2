import { CLI, Errors, FS, Platform, Repo, Time } from '@shared'

const [mode, suppliedRoot] = Platform.runtimeProcess.argv.slice(2)
if (!['short', 'escape'].includes(mode ?? '') || !suppliedRoot) {
  Errors.throwUserInput('The source barrier supervisor accepts only its fixed fixture modes and scratch directory.')
}
const root = await FS.realPath(suppliedRoot)
if (
  !FS.pathIsWithin(root, Repo.resolvePath('.artifacts/scratch'))
  || !FS.basename(root).startsWith('managed-command-barrier-')
) {
  Errors.throwUserInput('The source barrier supervisor requires its owned test scratch directory.')
}
const worker = CLI.start('/bin/bash', {
  args: [Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/managed-loop-command-barrier-worker.sh'), mode!, root],
  cwd: Repo.getRoot(),
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: false,
  processPolicy: 'server',
  onOutput: (stream, chunk) => Platform.runtimeProcess[stream].write(chunk),
})
Platform.runtimeProcess.stdout.write(`supervisor-worker ${worker.pid}\n`)
let closed: CLI.CommandCloseResult | undefined
void worker.waitForClose().then(value => {
  closed = value
})
let input = ''
let released = false
let finish = false
let refused = false
let eof = false
Platform.runtimeProcess.stdin.setEncoding('utf8')
Platform.runtimeProcess.stdin.on('data', chunk => {
  input += chunk
  if (input.length > 64) {
    refused = true
    worker.endStdin()
    return
  }
  while (input.includes('\n')) {
    const end = input.indexOf('\n')
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (line === 'run' && !released && closed === undefined && !refused) {
      released = true
      worker.writeStdin('execute-source\n')
    } else if (line === 'cancel' && !released && closed === undefined && !refused) {
      worker.endStdin()
    } else if (line === 'finish' && closed !== undefined && !refused) {
      finish = true
      Platform.runtimeProcess.stdin.pause()
    } else {
      refused = true
      worker.endStdin()
    }
  }
})
Platform.runtimeProcess.stdin.on('end', () => {
  eof = true
  worker.endStdin()
})
// budget-ok: Fixed source children and the shell's ACK wait must terminate inside this spike's explicit lifetime.
if (!await Time.pollUntil(() => closed, { intervalMs: 25, timeoutMs: 15_000 })) {
  Platform.runtimeProcess.exit(73)
}
await worker.closeOutput()
worker.dispose()
Platform.runtimeProcess.stdout.write(`worker-closed ${JSON.stringify(closed)}\n`)
if (refused || eof) {
  Platform.runtimeProcess.exit(72)
}
// budget-ok: The supervisor stays alive for the parent's independent drain proof, but never indefinitely.
if (!await Time.pollUntil(() => finish || eof || refused ? true : undefined, { intervalMs: 25, timeoutMs: 10_000 })) {
  Platform.runtimeProcess.exit(74)
}
Platform.runtimeProcess.exit(finish && !refused ? 0 : 72)
