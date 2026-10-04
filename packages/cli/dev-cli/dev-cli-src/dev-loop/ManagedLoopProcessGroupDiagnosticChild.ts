import { Platform, Time } from '@shared'

// A fixed child entry: no caller arguments, descendants, resource leases, or cleanup signals.
let input = ''
let acknowledged = false
Platform.runtimeProcess.stdin.setEncoding('utf8')
Platform.runtimeProcess.stdin.on('data', chunk => {
  input = (input + chunk).slice(0, 16)
  if (!acknowledged && input === 'finish\n') {
    acknowledged = true
    Platform.runtimeProcess.stdin.pause()
    void Time.sleep(1000).then(() => Platform.runtimeProcess.exit(0))
  }
})
void Time.sleep(30_000).then(() => {
  if (!acknowledged) {
    Platform.runtimeProcess.exit(0)
  }
})
Platform.runtimeProcess.stdout.write('owned-group-ready\n')
