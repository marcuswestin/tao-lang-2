import { CLI, HCI } from '@shared'

const child = CLI.start('/bin/sleep', {
  args: ['30'],
  processPolicy: 'server',
  stdio: 'ignore',
  unref: true,
})
HCI.writeLine(String(child.pid))
