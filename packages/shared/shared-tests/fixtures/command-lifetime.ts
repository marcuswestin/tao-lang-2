/** Isolated runtime probe: module replacement and forced collection cannot share a test process. */
import { HCI } from '@shared'
import { MockModule } from '@shared/test'
import { EventEmitter } from 'node:events'
import * as Platform from '../../shared-src/Platform'

const originalPlatform = { ...Platform }
const mode = process.argv[2] ?? 'close'
let childRef: WeakRef<FixtureChild> | undefined

class FixtureStream extends EventEmitter {
  closed = false
  destroy() {
    this.closed = true
  }
}

class FixtureChild extends EventEmitter {
  pid = 9_000_001
  exitCode: number | null = null
  signalCode = null
  stdin = null
  stdout = new FixtureStream()
  stderr = new FixtureStream()
  get stdio() {
    return mode === 'aux'
      ? [this.stdin, this.stdout, this.stderr, new FixtureStream()]
      : [this.stdin, this.stdout, this.stderr]
  }
  kill() {
    return true
  }
  unref() {}
}

MockModule(new URL('../../shared-src/Platform.ts', import.meta.url).pathname, () => ({
  ...originalPlatform,
  spawn() {
    const child = new FixtureChild()
    childRef = new WeakRef(child)
    return child
  },
}))
const CLI = await import('../../shared-src/CLI')

function sentinel(): WeakRef<object> {
  return new WeakRef({ collectible: true })
}
const control = sentinel()
let completed: Awaited<ReturnType<typeof CLI.run>> | undefined
let disposed = false
function start() {
  if (mode === 'dispose') {
    CLI.start('lifetime-fixture').dispose()
    disposed = true
    return Promise.resolve()
  }
  return CLI.run('lifetime-fixture', mode === 'supervised' ? { processPolicy: 'test', detached: true } : {}).then(
    result => {
      completed = result
    },
  )
}
// Root the returned promise as the caller does. The promise has no reverse ownership edge to
// the event source responsible for settling it; only a WeakRef models that source's final delivery.
Object.assign(globalThis, { commandLifetimeResult: start() })

async function collectAcrossJobs(): Promise<void> {
  for (let round = 0; round < 12; round++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    // This Bun-specific subprocess probe exercises the runtime collector, not a timing budget.
    Bun.gc(true)
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

function deliverExit(): boolean {
  const child = childRef?.deref()
  if (child === undefined) {
    return false
  }
  child.stdout.emit('data', Buffer.from('before-close\n'))
  child.exitCode = 0
  child.emit('exit', 0, null)
  return true
}

function deliverClose(): boolean {
  const child = childRef?.deref()
  if (child === undefined) {
    return false
  }
  child.stdout.emit('data', Buffer.from('after-exit\n'))
  child.stderr.emit('data', Buffer.from('diagnostic-stderr\n'))
  child.stdout.emit('end')
  child.stderr.emit('end')
  child.stdout.closed = true
  child.stdout.emit('close')
  child.stderr.closed = true
  child.stderr.emit('close')
  // Deliberately omit the runtime's aggregate child close notification.
  return true
}

await collectAcrossJobs()
const controlCollected = control.deref() === undefined
const pendingBeforeDelivery = completed === undefined
const exitDelivered = disposed ? false : deliverExit()
await collectAcrossJobs()
const pendingAfterExit = completed === undefined
const retainedAfterExit = childRef?.deref() !== undefined
const pipesClosed = disposed ? false : deliverClose()
await new Promise<void>(resolve => setTimeout(resolve, 0))
const pendingBeforeAggregate = completed === undefined
if (mode === 'aux') {
  childRef?.deref()?.emit('close', 0, null)
}
await new Promise<void>(resolve => setTimeout(resolve, 0))
const outputPreserved = completed?.stdout === 'before-close\nafter-exit\n'
  && completed.stderr === 'diagnostic-stderr\n'
  && completed.exitCode === 0
await collectAcrossJobs()
HCI.writeLine(JSON.stringify({
  pipesClosed,
  controlCollected,
  exitDelivered,
  pendingAfterExit,
  pendingBeforeAggregate,
  retainedAfterExit,
  outputPreserved,
  pendingBeforeDelivery,
  released: childRef?.deref() === undefined,
}))
