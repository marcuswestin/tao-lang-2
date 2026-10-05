import { type MachineResourceOwner } from '@host-control'
import { CLI, Errors, FS, Repo } from '@shared'
import type { TrackedProcess } from '@shared/ProcessTree'
import { Describe, Expect, Test } from '@shared/test'
import { retireRetainedMobile } from '../dev-cli-src/dev-loop/DevLoopMobileRetirement'
import type { DevLoopReceipt } from '../dev-cli-src/dev-loop/DevLoopStore'

const session = '645bfecb-f6bf-473c-b3e2-3e12dae7f557'
const generation = 'a478abe2-f06e-4223-8cfa-ab35a0774904'
const deviceId = '46D4C535-F527-49CD-81DD-B3BBD45F9056'
const controller: TrackedProcess = { command: 'bun', pid: 200_001, startedAt: 'controller-start' }
const child: TrackedProcess = { command: 'env', pid: 200_002, startedAt: 'driver-start' }
const vanishedNewChild: TrackedProcess = { command: 'helper', pid: 200_004, startedAt: 'helper-start' }
async function fixture(
  fault?:
    | 'unknown-member'
    | 'reused-child'
    | 'other-refusal'
    | 'fence-drift'
    | 'listener-present'
    | 'stubborn-child'
    | 'grouped-port'
    | 'grouped-target'
    | 'callback-grouped-port'
    | 'vanished-new-child',
) {
  const checkout = await FS.realPath(Repo.getRoot())
  const target: MachineResourceOwner = {
    command: 'agent app-dev',
    id: 'device-generation',
    name: `ios-simulator:${deviceId}`,
    pid: controller.pid,
    processStartedAt: controller.startedAt,
    repositoryRoot: checkout,
    startedAt: '2026-10-05T00:00:00.000Z',
    retention: {
      processes: [],
      quarantined: true,
      reason: 'Managed driver cleanup is unproved.',
      resourceNames: fault === 'grouped-target'
        ? [`ios-simulator:${deviceId}`, 'appium-server-port-4723']
        : [`ios-simulator:${deviceId}`],
    },
  }
  const port: MachineResourceOwner = {
    ...target,
    id: 'port-generation',
    name: 'appium-server-port-4723',
    retention: {
      ...target.retention!,
      resourceNames: fault === 'grouped-port'
        ? ['appium-server-port-4723', target.name]
        : ['appium-server-port-4723'],
    },
  }
  let receipt: DevLoopReceipt = {
    version: 1,
    session,
    checkout,
    generation,
    state: 'ready',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    args: [],
    controller,
    children: [child],
    processGroups: [child],
    devices: [{
      platform: 'ios',
      id: deviceId,
      owned: true,
      state: 'booted',
      generation: target.id,
      holder: controller,
      resources: [target],
    }],
    mobileDriverCleanup: 'retained',
    mobileDriverProcesses: [child],
    provenance: 'uncertain',
    cleanupOutcome: 'retained',
    ownershipRefusal: {
      version: 1,
      generation,
      reason: fault === 'other-refusal'
        ? 'A different refusal.'
        : 'Managed mobile driver cleanup is unproved; target and driver fences remain retained.',
    },
  }
  let audit: unknown
  let controllerAlive = true
  let controlPresent = true
  let childAlive = true
  let targetOwner: MachineResourceOwner | undefined = target
  let portOwner: MachineResourceOwner | undefined = port
  let reused = false
  let allowKill = false
  let tick = 0
  const events: string[] = []
  const connection = {
    session,
    generation,
    controller,
    origin: 'http://127.0.0.1:60000',
    token: 'private-test-token',
  }
  const operations: NonNullable<Parameters<typeof retireRetainedMobile>[1]> = {
    withLock: async (_session, action) => await action(),
    readReceipt: async () => receipt,
    writeReceipt: async value => {
      receipt = value
      events.push('receipt')
    },
    readConnection: async () => {
      if (!controlPresent) {
        Errors.throwHostEnvironment('private control is absent')
      }
      return connection
    },
    controlPresent: async () => controlPresent,
    readOwner: async ({ name }) => name === target.name ? targetOwner : portOwner,
    listOwners: async () => portOwner === undefined ? [] : [portOwner],
    readAudit: async () => audit as never,
    writeAudit: async value => {
      audit = structuredClone(value)
      events.push(`audit:${value.phase}`)
    },
    identities: pids =>
      new Map([
        ...(controllerAlive && pids.includes(controller.pid) ? [[controller.pid, controller] as const] : []),
        ...(childAlive && pids.includes(child.pid)
          ? [[child.pid, { ...child, startedAt: reused ? 'reused-start' : child.startedAt }] as const]
          : []),
      ]),
    descendants: pid =>
      pid === controller.pid && childAlive
        ? fault === 'vanished-new-child' ? [child, vanishedNewChild] : [child]
        : [],
    groupMembers: () =>
      childAlive
        ? fault === 'unknown-member' ? [child, { command: 'foreign', pid: 200_003, startedAt: 'foreign' }] : [child]
        : [],
    isGroupAlive: () => childAlive,
    processGroupOf: pid => pid === vanishedNewChild.pid ? undefined : child.pid,
    processTable: () => [{
      ...controller,
      ppid: 1,
      command: `bun ${Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopWorker.ts')}`,
    }],
    signal: (tracked, signal) => {
      events.push(`signal:${signal}:${tracked.map(process => process.pid).join(',')}`)
      if (signal === 'SIGTERM') {
        if (tracked.some(process => process.pid === controller.pid)) {
          controllerAlive = false
        }
        if (tracked.some(process => process.pid === child.pid)) {
          if (fault === 'reused-child') {
            reused = true
          } else if (fault === 'stubborn-child') {
            childAlive = !allowKill
          } else {
            childAlive = false
          }
        }
        if (fault === 'fence-drift') {
          targetOwner = { ...target, id: 'changed-generation' }
        }
      }
      if (signal === 'SIGKILL') {
        controllerAlive = false
        childAlive = fault === 'stubborn-child' && !allowKill
      }
    },
    processIsAlive: pid => pid === controller.pid ? controllerAlive : pid === child.pid && childAlive,
    now: () => tick,
    sleep: async ms => {
      tick += ms
    },
    run: async (command, options) => {
      events.push(`${command}:${options?.args?.join(' ')}`)
      const listing = command === 'xcrun' && options?.args?.includes('list')
      return {
        command,
        args: [...options?.args ?? []],
        exitCode: command === 'lsof'
          ? fault === 'listener-present' ? 0 : 1
          : 0,
        signal: null,
        stdout: listing ? JSON.stringify({ devices: { available: [{ udid: deviceId, state: 'Shutdown' }] } }) : '',
        ...(command === 'lsof' && fault === 'listener-present'
          ? { stdout: `p${child.pid}\nf9\nn127.0.0.1:4723\n` }
          : {}),
        stderr: '',
        error: undefined,
      } as Awaited<ReturnType<typeof CLI.run>>
    },
    recoverRetained: async ({ name, generation: expected, shutdown }) => {
      const owner = name === target.name ? targetOwner : portOwner
      Expect(owner?.id).toBe(expected)
      const snapshot = fault === 'callback-grouped-port' && name === port.name
        ? { ...owner!, retention: { ...owner!.retention!, resourceNames: [port.name, target.name] } }
        : owner!
      Expect(await shutdown(snapshot)).toBe(true)
      if (name === target.name) {
        targetOwner = undefined
      } else {
        portOwner = undefined
      }
      events.push(`release:${name}`)
    },
    disposeConnection: async value => {
      events.push('dispose-control')
      return { ...value, controllerDisposed: true, cleanupOutcome: 'proved' }
    },
  }
  return {
    events,
    session,
    operations,
    receipt: () => receipt,
    audit: () => audit,
    target: () => targetOwner,
    originalTarget: target,
    changeTargetOwner: (owner: MachineResourceOwner) => {
      targetOwner = owner
    },
    port: () => portOwner,
    allowKill: () => {
      allowKill = true
    },
    disposeController: () => {
      receipt = { ...receipt, controllerDisposed: true, state: 'cleanup-failed' }
      controlPresent = false
    },
    removeControlWithoutDisposal: () => {
      controlPresent = false
    },
    reviveController: () => {
      controllerAlive = true
    },
  }
}

Describe('retained mobile retirement', () => {
  Test('retires only the captured identity and exact fences, preserving the original refusal', async () => {
    const context = await fixture()
    const result = await retireRetainedMobile(session, context.operations)
    Expect(result.retirementAudit).toEqual({
      version: 1,
      generation,
      path: 'mobile-retirement.json',
      outcome: 'proved',
    })
    Expect(result.state).toBe('cleanup-failed')
    Expect(result.cleanupOutcome).toBe('retained')
    Expect(result.ownershipRefusal?.reason).toBe(
      'Managed mobile driver cleanup is unproved; target and driver fences remain retained.',
    )
    Expect(context.events.indexOf('audit:admitted')).toBeLessThan(context.events.indexOf(`signal:SIGTERM:${child.pid}`))
    Expect(context.events.indexOf(`signal:SIGTERM:${controller.pid}`)).toBeLessThan(
      context.events.indexOf('audit:processes-proved'),
    )
    Expect(context.events.indexOf('release:appium-server-port-4723')).toBeLessThan(
      context.events.indexOf(`release:ios-simulator:${deviceId}`),
    )
    Expect(context.events.indexOf(`release:ios-simulator:${deviceId}`)).toBeLessThan(
      context.events.indexOf('dispose-control'),
    )
    Expect(context.target()).toBeUndefined()
    Expect(context.port()).toBeUndefined()
    Expect(result.devices?.[0]?.state).toBe('released')
  })

  for (
    const fault of [
      'unknown-member',
      'reused-child',
      'other-refusal',
      'fence-drift',
      'listener-present',
      'grouped-port',
      'grouped-target',
    ] as const
  ) {
    Test(`retains fences on ${fault} without signalling an unproved process`, async () => {
      const context = await fixture(fault)
      await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow()
      Expect(context.target()).toBeDefined()
      Expect(context.port()).toBeDefined()
      Expect(context.events.some(event => event.startsWith('release:'))).toBe(false)
      if (
        fault === 'unknown-member' || fault === 'other-refusal' || fault === 'grouped-port'
        || fault === 'grouped-target'
      ) {
        Expect(context.events.some(event => event.startsWith('signal:'))).toBe(false)
      } else {
        Expect(context.events.some(event => event.startsWith('signal:SIGKILL'))).toBe(false)
      }
    })
  }

  Test('refuses a grouped port manifest in the fresh release snapshot', async () => {
    const context = await fixture('callback-grouped-port')
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow()
    Expect(context.events.some(event => event.startsWith('signal:SIGTERM'))).toBe(true)
    Expect(context.events.some(event => event.startsWith('release:'))).toBe(false)
    Expect(context.target()).toBeDefined()
    Expect(context.port()).toBeDefined()
  })

  Test('refuses an exited newly captured descendant with no group proof before signalling', async () => {
    const context = await fixture('vanished-new-child')
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('group identity is unreadable')
    Expect(context.events.some(event => event.startsWith('signal:'))).toBe(false)
    Expect(context.events.some(event => event.startsWith('release:'))).toBe(false)
    Expect(context.target()).toBeDefined()
  })

  Test('accepts actual lsof PID, descriptor, and name fields for unrelated listeners', async () => {
    const context = await fixture()
    const run = context.operations.run!
    context.operations.run = async (command, options) => {
      const result = await run(command, options)
      return command === 'lsof'
        ? { ...result, exitCode: 0, stdout: 'p675\nf9\nn*:7000\nf10\nn[::1]:7000\np687\nf12\nn127.0.0.1:50754\n' }
        : result
    }
    const result = await retireRetainedMobile(session, context.operations)
    Expect(result.retirementAudit?.outcome).toBe('proved')
  })

  for (
    const [name, output, reason] of [
      ['unknown field', 'p675\nf9\nn*:7000\nxother\n', 'unknown field'],
      ['incomplete descriptor', 'p675\nf9\n', 'descriptor port'],
      ['captured port under another PID', 'p675\nf9\nn*:4723\n', 'still has a TCP listener'],
      ['captured PID on another port', `p${child.pid}\nf9\nn*:7000\n`, 'still has a TCP listener'],
    ] as const
  ) {
    Test(`refuses ${name} in listener inspection before fence release`, async () => {
      const context = await fixture()
      const run = context.operations.run!
      context.operations.run = async (command, options) => {
        const result = await run(command, options)
        return command === 'lsof' ? { ...result, exitCode: 0, stdout: output } : result
      }
      await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow(reason)
      Expect(context.events.some(event => event.startsWith('release:'))).toBe(false)
      Expect(context.target()).toBeDefined()
      Expect(context.port()).toBeDefined()
    })
  }

  Test('retry uses the durable first capture after the controller exits', async () => {
    const context = await fixture('stubborn-child')
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow(
      'process and group absence remains unproved',
    )
    Expect(context.events.includes('audit:admitted')).toBe(true)
    Expect(context.events.includes('audit:retained')).toBe(true)
    Expect(context.target()).toBeDefined()
    context.disposeController()
    context.allowKill()
    const result = await retireRetainedMobile(session, context.operations)
    Expect(result.retirementAudit?.outcome).toBe('proved')
    Expect(context.events.filter(event => event === 'audit:admitted')).toHaveLength(1)
    Expect(context.events.filter(event => event.startsWith('release:'))).toHaveLength(2)
  })

  Test('refuses absent private control without a durable capture', async () => {
    const context = await fixture()
    context.disposeController()
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('exact failed iOS session')
    Expect(context.events.some(event => event.startsWith('signal:'))).toBe(false)
  })

  Test('refuses missing private control when controller disposal was never proved', async () => {
    const context = await fixture()
    context.removeControlWithoutDisposal()
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('controller disposal disagree')
    Expect(context.events.some(event => event.startsWith('signal:'))).toBe(false)
  })

  Test('refuses disposed-controller retry while that PID remains live', async () => {
    const context = await fixture('stubborn-child')
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow()
    context.disposeController()
    context.reviveController()
    const before = context.events.length
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('private control')
    Expect(context.events).toHaveLength(before)
    Expect(context.target()).toBeDefined()
  })

  for (const interruption of ['dispose', 'target-audit', 'proof-audit', 'receipt'] as const) {
    Test(`reconciles ${interruption} interruption after target release without new authority`, async () => {
      const context = await fixture()
      let interrupted = false
      if (interruption === 'dispose') {
        const dispose = context.operations.disposeConnection!
        context.operations.disposeConnection = async value => {
          if (!interrupted) {
            interrupted = true
            Errors.throwHostEnvironment('injected disposal interruption')
          }
          return await dispose(value)
        }
      } else if (interruption === 'receipt') {
        const writeReceipt = context.operations.writeReceipt!
        context.operations.writeReceipt = async value => {
          if (!interrupted) {
            interrupted = true
            Errors.throwHostEnvironment('injected receipt interruption')
          }
          await writeReceipt(value)
        }
      } else {
        const writeAudit = context.operations.writeAudit!
        const phase = interruption === 'target-audit' ? 'target-released' : 'proved'
        context.operations.writeAudit = async value => {
          if (value.phase === phase && !interrupted) {
            interrupted = true
            Errors.throwHostEnvironment('injected audit interruption')
          }
          await writeAudit(value)
        }
      }
      await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('injected')
      Expect(interrupted).toBe(true)
      Expect(context.target()).toBeUndefined()
      const destructive = context.events.filter(event =>
        event.startsWith('signal:') || event.startsWith('release:') || event === `xcrun:simctl shutdown ${deviceId}`
      )
      context.operations.readConnection = async () => {
        Errors.throwHostEnvironment('private connection must not be read after target release')
      }
      const result = await retireRetainedMobile(session, context.operations)
      Expect(result.retirementAudit?.outcome).toBe('proved')
      Expect(result.ownershipRefusal?.reason).toBe(
        'Managed mobile driver cleanup is unproved; target and driver fences remain retained.',
      )
      Expect(
        context.events.filter(event =>
          event.startsWith('signal:') || event.startsWith('release:') || event === `xcrun:simctl shutdown ${deviceId}`
        ),
      ).toEqual(destructive)
    })
  }

  Test('post-release retry refuses a changed physical owner without acting on it', async () => {
    const context = await fixture()
    const dispose = context.operations.disposeConnection!
    context.operations.disposeConnection = async () => {
      Errors.throwHostEnvironment('injected disposal interruption')
    }
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('injected')
    context.operations.disposeConnection = dispose
    context.changeTargetOwner({ ...context.originalTarget, id: 'new-physical-generation' })
    const before = context.events.length
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow()
    Expect(context.events).toHaveLength(before)
  })

  Test('retry accepts a committed final receipt after its response was interrupted', async () => {
    const context = await fixture()
    const writeReceipt = context.operations.writeReceipt!
    let interrupted = false
    context.operations.writeReceipt = async value => {
      await writeReceipt(value)
      if (!interrupted) {
        interrupted = true
        Errors.throwHostEnvironment('injected response interruption')
      }
    }
    await Expect(retireRetainedMobile(session, context.operations)).rejects.toThrow('injected')
    const before = [...context.events]
    context.operations.readConnection = async () => {
      Errors.throwHostEnvironment('private control must not be read after publication')
    }
    const result = await retireRetainedMobile(session, context.operations)
    Expect(result.retirementAudit?.outcome).toBe('proved')
    Expect(context.events).toEqual([
      ...before,
      'lsof:-nP -iTCP -sTCP:LISTEN -Fpn',
      'xcrun:simctl list devices --json available',
    ])
  })
})
