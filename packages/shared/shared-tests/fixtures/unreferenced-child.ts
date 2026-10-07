import { CLI, Errors, HCI, ProcessTree } from '@shared'

const child = CLI.start('/bin/sleep', {
  args: ['30'],
  processPolicy: 'server',
  stdio: 'ignore',
  unref: true,
})
const identity = child.pid === undefined ? undefined : ProcessTree.identities([child.pid]).get(child.pid)
if (identity === undefined) {
  Errors.throwUnexpected('Expected an exact identity for the unreferenced fixture child.')
}
HCI.writeLine(JSON.stringify(identity))
