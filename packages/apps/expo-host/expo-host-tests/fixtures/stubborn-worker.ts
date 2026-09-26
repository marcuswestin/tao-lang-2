import { Platform } from '@shared'

// Both processes ignore EOF and TERM. The descendant leaves its parent's process group, so
// group-only cleanup cannot pass the Node-hosted escalation regression.
Platform.onProcessSignal('SIGTERM', () => {})
if (Platform.runtimeProcess.argv[2] === 'descendant') {
  Platform.runtimeProcess.stdout.write('ready\n')
} else {
  Platform.runtimeProcess.stdin.resume()
  const child = Platform.spawn(Platform.runtimeProcess.execPath, {
    args: [Platform.runtimeProcess.argv[1]!, 'descendant'],
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  child.stdout!.once('data', () => Platform.runtimeProcess.stdout.write(`${child.pid}\n`))
}
setInterval(() => {}, 1_000)
