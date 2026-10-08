import { CLI, Errors, HCI, ProcessTree } from '@shared'

// A parent that starts one linked sleeper and one plain sleeper, publishes both identities, and
// then idles until the test kills it. The linked sleeper must die with this process; the plain one
// must survive, which proves the link reaches only what it was attached to.
const linked = CLI.start('/bin/sleep', {
  args: ['300'],
  lifetime: 'dies-with-parent',
  processPolicy: 'server',
  stdio: 'ignore',
})
const plain = CLI.start('/bin/sleep', {
  args: ['300'],
  detached: true,
  processPolicy: 'server',
  stdio: 'ignore',
})

function identityOf(pid: number | undefined, name: string) {
  const identity = pid === undefined ? undefined : ProcessTree.identities([pid]).get(pid)
  if (identity === undefined) {
    Errors.throwUnexpected(`Expected an exact identity for the ${name} fixture child.`)
  }
  return identity
}

HCI.writeLine(JSON.stringify({
  linked: identityOf(linked.pid, 'linked'),
  plain: identityOf(plain.pid, 'plain'),
}))
setInterval(() => {}, 1000)
