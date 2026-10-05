import { Platform } from '@shared'

// A fixed source-only probe: no target, executable, or native operation can be selected by its input.
let input = ''
Platform.runtimeProcess.stdin.setEncoding('utf8')
Platform.runtimeProcess.stdin.on('data', chunk => {
  input += chunk
  if (input.length > 8 || input.includes('\n') && input !== 'run\n') {
    Platform.runtimeProcess.exit(125)
  }
  if (input === 'run\n') {
    Platform.runtimeProcess.stdout.write('fixed source launch completed\n')
    Platform.runtimeProcess.exit(0)
  }
})
Platform.runtimeProcess.stdin.on('end', () => Platform.runtimeProcess.exit(125))
