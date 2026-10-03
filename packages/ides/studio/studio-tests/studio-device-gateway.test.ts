import {
  StudioDeviceProtocol,
  type TaoStudioDeviceClearMessage,
  TaoStudioDeviceProtocol,
  type TaoStudioDeviceRejectCode,
  type TaoStudioDeviceStudioHelloMessage,
  type TaoStudioDeviceStudioMessage,
} from '@runtime/TR-studio-device-protocol'
import { StudioDeviceTrust, type TaoStudioDeviceSessionKeys } from '@runtime/TR-studio-device-trust'
import { CLI, Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import {
  StudioDeviceGateway,
  type StudioDeviceGatewayOptions,
  type StudioDeviceGatewaySessionRef,
} from '../studio-src/device/StudioDeviceGateway'
import type { StudioDeviceStatus } from '../studio-src/device/StudioDeviceStatus'
import { StudioDeviceTrustStore } from '../studio-src/device/StudioDeviceTrustStore'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { StudioProjectSession } from '../studio-src/StudioProjectSession'
import { systemLightScheme } from './test-studio-fixtures'

Describe('Studio device gateway handshake', () => {
  Test('advertises the exact gateway key and port and stops the Bonjour registration with the gateway', async () => {
    let advertised: { port: number; studioPublicKey: string } | undefined
    let stops = 0
    await withGateway({
      bonjour: options => {
        advertised = { port: options.port, studioPublicKey: options.studioPublicKey }
        return { args: [], stop: () => stops += 1 }
      },
    }, async env => {
      Expect(advertised).toEqual({ port: env.gateway.port, studioPublicKey: env.store.publicKey() })
    })
    Expect(stops).toBe(1)
  })

  Test('rejects an unknown device while pairing is closed and lets it in once a window opens', async () => {
    await withGateway({}, async env => {
      const device = new TestDevice(env.gateway.port)
      await device.sendHello({ metroPort: env.metroPort })
      const closed = await device.rejected()
      Expect(closed).toMatchObject({ closeCode: 4000, code: 'pairing-closed' })

      const statuses: StudioDeviceStatus[] = []
      const unsubscribe = env.gateway.subscribe(env.sessionId, status => statuses.push(status))
      const opened = env.gateway.openPairing(env.sessionId)
      Expect(Date.parse(opened.expiresAt)).toBe(fixedNow.getTime() + TaoStudioDeviceProtocol.pairingWindowMs)
      Expect(env.gateway.status(env.sessionId).pairing).toEqual({ expiresAt: opened.expiresAt, open: true })

      const again = new TestDevice(env.gateway.port)
      const hello = await again.connect({ metroPort: env.metroPort })
      Expect(hello.mode).toBe('pair')
      Expect(hello.studioPublicKey).toBe(env.store.publicKey())
      Expect(await again.nextSealed()).toEqual({ type: 'studio.pairingPending' })
      const pending = await until(() => env.gateway.status(env.sessionId).pairing.pending, {
        description: 'the pending device in the status snapshot',
      })
      Expect(pending).toEqual({
        code: again.keys!.code,
        device: again.description,
        devicePublicKey: again.identity.publicKey,
        fingerprint: StudioDeviceTrust.fingerprint(again.identity.publicKey),
      })
      Expect(env.gateway.status(env.sessionId).connection).toMatchObject({ state: 'pairing', transport: 'lan' })

      Expect(await env.gateway.confirmPairing(env.sessionId, again.identity.publicKey)).toEqual({ accepted: true })
      const welcome = await again.nextSealed()
      Expect(welcome).toMatchObject({
        appName: 'Garden',
        capabilities: ['render', 'select-cell', 'applied-revision'],
        compile: { appliedRevision: 0, compileRevision: 1, status: 'compiled' },
        heartbeatMs: TaoStudioDeviceProtocol.heartbeatMs,
        projectLabel: FS.basename(env.session.projectRoot),
        sessionId: env.sessionId,
        type: 'studio.welcome',
      })
      Expect(welcome.type === 'studio.welcome' ? welcome.manifest : undefined).toEqual({
        compileRevision: 1,
        manifestRevision: 'manifest-1',
        scenarios: [
          {
            cellId: 'cell:phone',
            cellRevision: 0,
            group: 'Garden',
            label: 'Garden phone',
            scenarioId: 'Garden.phone',
            viewport: { height: 844, width: 390 },
          },
          {
            cellId: 'cell:tablet',
            cellRevision: 0,
            group: 'Garden',
            label: 'Garden phone',
            scenarioId: 'Garden.phone',
            viewport: { height: 1194, width: 834 },
          },
        ],
      })
      const status = env.gateway.status(env.sessionId)
      Expect(status.pairing).toEqual({ open: false })
      Expect(status.connection).toMatchObject({
        device: again.description,
        fingerprint: StudioDeviceTrust.fingerprint(again.identity.publicKey),
        state: 'connected',
      })
      Expect(status.trusted).toHaveLength(1)
      Expect(status.trusted[0]).toMatchObject({
        device: again.description,
        devicePublicKey: again.identity.publicKey,
        pairedAt: fixedNow.toISOString(),
      })
      Expect(status.gateway).toEqual({
        hosts: ['192.168.1.20'],
        port: env.gateway.port,
        studioFingerprint: env.store.fingerprint(),
      })
      Expect(JSON.stringify(status)).not.toContain(env.session.projectRoot)
      Expect(JSON.stringify(status)).not.toContain(env.store.identity().secretKey)
      Expect(statuses.map(item => item.connection?.state)).toEqual([
        undefined,
        undefined,
        'pairing',
        'connected',
      ])
      unsubscribe()
      again.close()
    })
  })

  Test('declines a pending device and admits only one unknown device per window', async () => {
    await withGateway({}, async env => {
      env.gateway.openPairing(env.sessionId)
      const first = new TestDevice(env.gateway.port)
      await first.connect({ metroPort: env.metroPort })
      Expect(await first.nextSealed()).toEqual({ type: 'studio.pairingPending' })

      const second = new TestDevice(env.gateway.port)
      await second.sendHello({ metroPort: env.metroPort })
      Expect((await second.rejected()).code).toBe('pairing-closed')

      Expect(() => env.gateway.declinePairing(env.sessionId, second.identity.publicKey)).toThrow('waiting to pair')
      Expect(env.gateway.declinePairing(env.sessionId, first.identity.publicKey)).toEqual({ declined: true })
      Expect((await first.rejected()).code).toBe('pairing-declined')
      Expect(env.store.isTrusted(first.identity.publicKey)).toBe(false)
      Expect(env.gateway.status(env.sessionId).pairing.pending).toBeUndefined()
      Expect(env.gateway.status(env.sessionId).pairing.open).toBe(true)

      // Declining frees the slot for the next device, and so does a pending device that walks away.
      const third = new TestDevice(env.gateway.port)
      await third.connect({ metroPort: env.metroPort })
      Expect(await third.nextSealed()).toEqual({ type: 'studio.pairingPending' })
      third.close()
      await until(() => env.gateway.status(env.sessionId).pairing.pending === undefined, {
        description: 'the pending slot to clear after the device disconnected',
      })
      const fourth = new TestDevice(env.gateway.port)
      await fourth.connect({ metroPort: env.metroPort })
      Expect(await fourth.nextSealed()).toEqual({ type: 'studio.pairingPending' })
      Expect(env.gateway.status(env.sessionId).pairing.pending?.devicePublicKey).toBe(fourth.identity.publicKey)
    })
  })

  Test('reconnects a trusted device without a window and replaces its older connection', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      const later = new Date(fixedNow.getTime() + 60_000)
      env.clock.now = later
      const reconnecting = new TestDevice(env.gateway.port, device.identity)
      const hello = await reconnecting.connect({ sessionId: env.sessionId })
      Expect(hello.mode).toBe('reconnect')
      Expect((await reconnecting.nextSealed()).type).toBe('studio.welcome')
      Expect((await device.rejected()).code).toBe('replaced')
      await until(() => env.store.trusted()[0]?.lastSeenAt === later.toISOString(), {
        description: 'the trust store to record the reconnect',
      })
      Expect(env.store.trusted()[0]?.pairedAt).toBe(fixedNow.toISOString())
      Expect(env.gateway.status(env.sessionId).connection?.state).toBe('connected')
      reconnecting.close()
      await until(() => env.gateway.status(env.sessionId).connection === undefined, {
        description: 'the status snapshot to drop the closed connection',
      })
    })
  })

  Test('revokes a live device and refuses its next hello', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      Expect(await env.gateway.revoke(env.sessionId, device.identity.publicKey)).toEqual({ revoked: true })
      Expect(await device.nextSealed()).toEqual({ reason: 'Studio revoked this device.', type: 'studio.revoked' })
      Expect(await device.rejected()).toMatchObject({ closeCode: 4001, code: 'revoked' })
      Expect(env.gateway.status(env.sessionId).trusted).toEqual([])

      const again = new TestDevice(env.gateway.port, device.identity)
      await again.sendHello({ metroPort: env.metroPort })
      Expect((await again.rejected()).code).toBe('pairing-closed')
      Expect(await env.gateway.revoke(env.sessionId, device.identity.publicKey)).toEqual({ revoked: false })
    })
  })

  Test('observes a revocation committed by an independent Studio process', async () => {
    await withGateway({ trustRefreshMs: 20 }, async env => {
      const device = await pairedDevice(env)
      const modulePath = Repo.resolvePath('packages/ides/studio/studio-src/device/StudioDeviceTrustStore.ts')
      const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
      const result = await CLI.run('bun', {
        args: [
          '-e',
          `
          import { StudioDeviceTrustStore } from ${JSON.stringify(modulePath)}
          import { HCI } from ${JSON.stringify(sharedPath)}
          const store = await StudioDeviceTrustStore.open(${JSON.stringify(env.trustRoot)})
          HCI.writeLine(String(await store.revoke(${JSON.stringify(device.identity.publicKey)})))
        `,
        ],
        stdio: 'pipe',
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe('true')
      Expect(await device.nextSealed()).toEqual({ reason: 'Studio revoked this device.', type: 'studio.revoked' })
      Expect((await device.rejected()).code).toBe('revoked')
      await until(() => env.gateway.status(env.sessionId).connection === undefined, {
        description: 'the cross-process revocation to detach the live device',
      })
    })
  })

  Test('rejects a confirm replayed from a previous handshake', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      const replayed = device.lastConfirm!
      device.close()
      const attacker = new TestDevice(env.gateway.port, device.identity)
      await attacker.sendHello({ metroPort: env.metroPort })
      const hello = await attacker.next()
      Expect(hello.kind === 'clear' && hello.message?.type).toBe('studio.hello')
      attacker.sendText(JSON.stringify({ signature: replayed, type: 'device.confirm' }))
      Expect((await attacker.rejected()).code).toBe('bad-signature')
    })
  })

  Test('names every malformed handshake and enforces the hello limit and timeout', async () => {
    await withGateway({ handshakeTimeoutMs: 60 }, async env => {
      const cases: Array<[string, string | Record<string, unknown>, TaoStudioDeviceRejectCode]> = [
        ['unknown metro port', hello(env, { metroPort: 1 }), 'unknown-session'],
        ['unknown session id', hello(env, { sessionId: 'nope' }), 'unknown-session'],
        ['wrong protocol', { ...hello(env, {}), protocol: 'tao-studio-device-v2' }, 'unsupported-protocol'],
        ['invalid JSON', '{"type": "device.hello"', 'malformed'],
        ['confirm before hello', { signature: 'sig', type: 'device.confirm' }, 'malformed'],
        ['short nonce', { ...hello(env, {}), nonce: 'c2hvcnQ=' }, 'malformed'],
        [
          'oversized hello',
          { ...hello(env, {}), padding: 'x'.repeat(TaoStudioDeviceProtocol.helloLimitBytes) },
          'oversized',
        ],
      ]
      for (const [label, frame, code] of cases) {
        const device = new TestDevice(env.gateway.port)
        await device.open()
        device.sendText(typeof frame === 'string' ? frame : JSON.stringify(frame))
        Expect([label, (await device.rejected()).code]).toEqual([label, code])
      }
      const silent = new TestDevice(env.gateway.port)
      await silent.open()
      Expect((await silent.rejected()).code).toBe('timeout')
      Expect(env.gateway.status(env.sessionId).connection).toBeUndefined()
    })
  })

  Test('a low-order ephemeral key does not jam the pairing slot against the next device', async () => {
    await withGateway({}, async env => {
      env.gateway.openPairing(env.sessionId)
      // A 32-byte all-zero key passes the length check every valid X25519 key also passes, but is a
      // known low-order point: shared-secret derivation throws on it, after `state.pending` is
      // already claimed for this connection. If disposal cannot attribute that claim back to this
      // session, the slot stays jammed and every other device is refused as "already pairing" until
      // the window closes and reopens.
      const attacker = new TestDevice(env.gateway.port)
      await attacker.open()
      attacker.sendText(JSON.stringify({
        ...hello(env, {}),
        devicePublicKey: attacker.identity.publicKey,
        ephemeralPublicKey: Buffer.alloc(32).toString('base64'),
      }))
      Expect((await attacker.rejected()).code).toBe('malformed')

      const legitimate = new TestDevice(env.gateway.port)
      const studioHello = await legitimate.connect({ metroPort: env.metroPort })
      Expect(studioHello.mode).toBe('pair')
    })
  })

  Test('answers the probe and refuses every other HTTP path', async () => {
    await withGateway({}, async env => {
      const probe = await fetch(`http://127.0.0.1:${env.gateway.port}/device/probe`)
      Expect(await probe.json()).toEqual({ protocol: TaoStudioDeviceProtocol.name })
      const other = await fetch(`http://127.0.0.1:${env.gateway.port}/api/files`)
      Expect(other.status).toBe(404)
      const plain = await fetch(`http://127.0.0.1:${env.gateway.port}/device`)
      Expect(plain.status).toBe(426)
    })
  })
})

Describe('Studio device gateway sealed control plane', () => {
  Test('assigns fresh preview instances and acknowledges applied revisions through the session', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const assigned = await device.nextSealed()
      Expect(assigned.type).toBe('studio.cellAssigned')
      if (assigned.type !== 'studio.cellAssigned') {
        return
      }
      Expect(assigned.identity).toMatchObject({
        appName: 'Garden',
        cellId: 'cell:phone',
        cellRevision: 0,
        compileRevision: 1,
        manifestRevision: 'manifest-1',
      })
      // The device gets the bootstrap record it renders from, minus `identity`: that field carries
      // the project's absolute root, which the gateway never lets a device learn, and the device host
      // reads only `cell`, `resolvedState`, and `replay`.
      const { identity: withheld, ...expectedRuntime } = env.session.previewCellInstance(
        assigned.identity.previewInstanceId,
      ) as unknown as Record<string, unknown>
      Expect(withheld).toMatchObject({ project: env.session.projectRoot })
      Expect(assigned.runtime).toEqual(expectedRuntime)
      Expect(Object.keys(assigned.runtime as Record<string, unknown>)).not.toContain('identity')
      Expect(JSON.stringify(assigned.runtime)).not.toContain(env.session.projectRoot)
      Expect(env.gateway.status(env.sessionId).connection).toMatchObject({
        cellId: 'cell:phone',
        scenarioLabel: 'Garden phone',
      })

      device.sendSealed({ cellId: 'cell:tablet', type: 'device.selectCell' })
      const reassigned = await device.nextSealed()
      Expect(reassigned.type === 'studio.cellAssigned' && reassigned.identity.cellId).toBe(
        'cell:tablet',
      )
      // A device renders one cell at a time, so selecting another releases its previous instance.
      Expect(() => env.session.previewCellInstance(assigned.identity.previewInstanceId)).toThrow('no longer current')

      Expect(env.gateway.selectCell(env.sessionId, 'cell:phone')).toEqual({ requested: true })
      const fromStudio = await device.nextSealed()
      Expect(fromStudio.type === 'studio.cellAssigned' && fromStudio.identity.cellId).toBe(
        'cell:phone',
      )
      const identity = fromStudio.type === 'studio.cellAssigned' ? fromStudio.identity : assigned.identity

      device.sendSealed({ appliedRevision: 1, compileRevision: 1, identity, type: 'device.applied' })
      const events = [await device.nextSealed(), await device.nextSealed()]
      Expect(events).toContainEqual({ accepted: true, compileRevision: 1, type: 'studio.appliedAck' })
      Expect(events.find(event => event.type === 'studio.compileState')).toMatchObject({
        appliedRevision: 1,
        compileRevision: 1,
        status: 'compiled',
      })
      Expect(env.session.compileSnapshot().appliedRevision).toBe(1)
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(1)

      device.sendSealed({
        appliedRevision: 1,
        compileRevision: 1,
        identity: { ...identity, previewInstanceId: 'stale' },
        type: 'device.applied',
      })
      Expect(await device.nextSealed()).toEqual({ accepted: false, compileRevision: 1, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.lastError).toContain('no longer current')

      // A refused claim proves nothing about the device's real revision — an arbitrarily high one
      // must not turn the panel's status green for a device the session just refused.
      device.sendSealed({
        appliedRevision: 99,
        compileRevision: 1,
        identity: { ...identity, previewInstanceId: 'stale' },
        type: 'device.applied',
      })
      Expect(await device.nextSealed()).toEqual({ accepted: false, compileRevision: 1, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(1)

      // Nor can a device inflate the number behind an identity that is genuinely current: the
      // recorded revision never exceeds one Studio compiled.
      device.sendSealed({ appliedRevision: 99, compileRevision: 99, identity, type: 'device.applied' })
      Expect(await device.nextSealed()).toEqual({ accepted: false, compileRevision: 99, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(1)

      // Re-acknowledging a revision the coordinator already advanced is not a refusal: it answers
      // `accepted: false` because there is nothing left to advance, and the device's own claim about
      // what it is showing is still true, so the panel keeps reporting it rather than "not reported".
      device.sendSealed({ appliedRevision: 1, compileRevision: 1, identity, type: 'device.applied' })
      Expect(await device.nextSealed()).toEqual({ accepted: false, compileRevision: 1, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(1)
      Expect(env.gateway.status(env.sessionId).connection?.lastError).toBeUndefined()

      device.sendSealed({ cellId: 'cell:missing', type: 'device.selectCell' })
      Expect(await device.nextSealed()).toMatchObject({
        cellId: 'cell:missing',
        code: 'unknown-cell',
      })
      device.sendSealed({ type: 'device.ping' })
      Expect(await device.nextSealed()).toEqual({ type: 'studio.pong' })
      device.sendSealed({ level: 'error', message: 'Render failed', type: 'device.report' })
      await until(() => env.gateway.status(env.sessionId).connection?.lastReport?.message === 'Render failed', {
        description: 'the device report in the status snapshot',
      })
      device.sendSealed({ type: 'device.explode' })
      Expect(await device.nextSealed()).toMatchObject({ code: 'unknown-message', type: 'studio.error' })
      Expect(env.gateway.requestReconnect(env.sessionId)).toEqual({ requested: true })
      Expect(await device.nextSealed()).toEqual({ type: 'studio.reconnect' })
    })
  })

  Test('records a device claim the browser already advanced past, and refuses one that never compiled', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const first = await device.nextSealed()
      const firstIdentity = first.type === 'studio.cellAssigned' ? first.identity : undefined
      Expect(firstIdentity).toBeDefined()
      device.sendSealed({ appliedRevision: 1, compileRevision: 1, identity: firstIdentity, type: 'device.applied' })
      await until(() => env.gateway.status(env.sessionId).connection?.appliedRevision === 1, {
        description: 'the first acknowledgement to reach the connection',
      })

      // Recompile. The device is reassigned at revision 2, and the browser canvas gets its
      // acknowledgement in first, which is what leaves the coordinator with nothing to advance.
      await env.session.compileInitial()
      let assigned: TaoStudioDeviceStudioMessage | undefined
      while (assigned?.type !== 'studio.cellAssigned') {
        assigned = await device.nextSealed()
      }
      const identity = assigned.identity
      Expect(identity.compileRevision).toBe(2)
      const browserInstance = 'browser-instance-1'
      env.session.registerCellPreview({
        appName: identity.appName,
        cellId: 'cell:phone',
        cellRevision: identity.cellRevision,
        compileRevision: identity.compileRevision,
        manifestRevision: identity.manifestRevision,
        previewInstanceId: browserInstance,
        project: env.session.projectRoot,
      })
      Expect(env.session.acknowledgePreview({
        appliedRevision: 2,
        channel: 'tao-studio',
        compileRevision: 2,
        identity: {
          appName: identity.appName,
          cellId: 'cell:phone',
          cellRevision: identity.cellRevision,
          compileRevision: identity.compileRevision,
          manifestRevision: identity.manifestRevision,
          previewInstanceId: browserInstance,
          project: env.session.projectRoot,
        },
        protocolVersion: 1,
        type: 'preview-applied',
      })).toBe(true)
      Expect(env.session.compileSnapshot().appliedRevision).toBe(2)
      // The connection still reports 1, so "recorded" and "left alone" are observably different.
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(1)

      device.sendSealed({ appliedRevision: 2, compileRevision: 2, identity, type: 'device.applied' })
      let alreadyAdvanced: TaoStudioDeviceStudioMessage | undefined
      while (alreadyAdvanced?.type !== 'studio.appliedAck') {
        alreadyAdvanced = await device.nextSealed()
      }
      Expect(alreadyAdvanced).toEqual({ accepted: false, compileRevision: 2, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(2)
      Expect(env.gateway.status(env.sessionId).connection?.lastError).toBeUndefined()

      // A compile that fails still advances compileRevision to 3 while nothing was ever built at 3.
      // The device's identity stays current, so nothing refuses it — only the bound can.
      env.compile.failNext = true
      await env.session.compileInitial().catch(() => undefined)
      Expect(env.session.compileSnapshot().compileRevision).toBe(3)
      Expect(env.session.compileSnapshot().appliedRevision).toBe(2)
      device.sendSealed({ appliedRevision: 3, compileRevision: 3, identity, type: 'device.applied' })
      let ack: TaoStudioDeviceStudioMessage | undefined
      while (ack?.type !== 'studio.appliedAck') {
        ack = await device.nextSealed()
      }
      Expect(ack).toEqual({ accepted: false, compileRevision: 3, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(2)
    })
  })

  Test('asks a device for its runtime state and reports a refusal, a silence, or a stop as an answer', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      const captured = { domains: [{ domain: 'data', value: { workspaces: 2 } }], version: 1 }

      const wanted = env.gateway.captureRuntime(env.sessionId)
      let request: TaoStudioDeviceStudioMessage | undefined
      while (request?.type !== 'studio.captureRuntime') {
        request = await device.nextSealed()
      }
      device.sendSealed({ capture: captured, requestId: request.requestId, type: 'device.runtimeCaptured' })
      Expect(await wanted).toEqual({ capture: captured })

      // A device that cannot capture answers the same request rather than going quiet.
      const refused = env.gateway.captureRuntime(env.sessionId)
      let second: TaoStudioDeviceStudioMessage | undefined
      while (second?.type !== 'studio.captureRuntime') {
        second = await device.nextSealed()
      }
      Expect(second.requestId).not.toBe(request.requestId)
      device.sendSealed({
        error: 'the data domain is unavailable',
        requestId: second.requestId,
        type: 'device.runtimeCaptureFailed',
      })
      Expect(await refused).toEqual({ error: 'the data domain is unavailable' })

      // A device that never answers resolves as a timeout, not a hung promise.
      const timedOut = await env.gateway.captureRuntime(env.sessionId, 10)
      Expect(typeof timedOut.error).toBe('string')
      Expect(timedOut.capture).toBeUndefined()

      // An answer to a request that already resolved is ignored rather than crashing the connection.
      device.sendSealed({ capture: captured, requestId: request.requestId, type: 'device.runtimeCaptured' })
      device.sendSealed({ type: 'device.ping' })
      let pong: TaoStudioDeviceStudioMessage | undefined
      while (pong?.type !== 'studio.pong') {
        pong = await device.nextSealed()
      }
      Expect(env.gateway.status(env.sessionId).connection?.state).toBe('connected')
    })
  })

  Test('delivers trusted device console lines in the session status with a stable sequence', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      const statuses: StudioDeviceStatus[] = []
      const unsubscribe = env.gateway.subscribe(env.sessionId, status => statuses.push(status))
      device.sendSealed({
        entries: [
          { level: 'info', message: 'ready', timestamp: 100 },
          { level: 'warn', message: 'slow request', timestamp: 101 },
        ],
        type: 'device.log',
      })
      const logs = await until(() =>
        env.gateway.status(env.sessionId).logs?.length === 2
          ? env.gateway.status(env.sessionId).logs
          : undefined
      )
      Expect(logs).toMatchObject([
        { deviceName: device.description.name, level: 'info', message: 'ready', sequence: 1, timestamp: 100 },
        { deviceName: device.description.name, level: 'warn', message: 'slow request', sequence: 2, timestamp: 101 },
      ])
      Expect(statuses.at(-1)?.logs).toEqual(logs)
      unsubscribe()
    })
  })

  Test('keeps only acknowledged current-cell Lens samples with the published source version', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const assigned = await nextAssignedCell(device)
      device.sendSealed({
        appliedRevision: assigned.identity.compileRevision,
        compileRevision: assigned.identity.compileRevision,
        identity: assigned.identity,
        type: 'device.applied',
      })
      await until(
        () => env.gateway.status(env.sessionId).connection?.appliedRevision === assigned.identity.compileRevision,
        { description: 'the assigned device cell acknowledgement' },
      )
      const path = 'Garden.tao'
      const sourceVersion = env.session.previewManifest()!.sourceVersions[path]!
      const sample = {
        actualDurationMs: 17.25,
        causes: [{ kind: 'state' as const }, { entity: 'Story', kind: 'data' as const, schema: 'Stories' }],
        instanceId: 'phone-render',
        occurrence: { end: 50, sourcePath: path, sourceVersion, start: 30 },
        phase: 'update' as const,
        timestamp: 100,
      }
      device.sendSealed({ samples: [sample], type: 'device.lens' })
      Expect(
        await until(
          () => env.gateway.status(env.sessionId).lensSamples?.[0],
          { description: 'the fresh device Lens observation' },
        ),
      ).toEqual({ ...sample, deviceName: device.description.name })

      device.sendSealed({
        samples: [{
          ...sample,
          instanceId: 'stale-render',
          occurrence: { ...sample.occurrence, sourceVersion: 'old' },
        }],
        type: 'device.lens',
      })
      device.sendSealed({ type: 'device.ping' })
      while ((await device.nextSealed()).type !== 'studio.pong') {
        // The reply confirms the preceding stale sample was processed, regardless of host load.
      }
      Expect(env.gateway.status(env.sessionId).lensSamples).toHaveLength(1)

      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const sameCell = await nextAssignedCell(device)
      Expect(sameCell.identity.cellId).toBe('cell:phone')
      Expect(env.gateway.status(env.sessionId).lensSamples).toHaveLength(1)

      device.sendSealed({ cellId: 'cell:tablet', type: 'device.selectCell' })
      const reassigned = await nextAssignedCell(device)
      Expect(reassigned.identity.cellId).toBe('cell:tablet')
      Expect(env.gateway.status(env.sessionId).lensSamples).toBeUndefined()
    })
  })

  Test('detaches a closed project session, its preview instance, and pending capture', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const assigned = await nextAssignedCell(device)
      const capture = env.gateway.captureRuntime(env.sessionId, 60_000)
      while ((await device.nextSealed()).type !== 'studio.captureRuntime') {
        // Drain any compile or assignment state emitted before the capture request.
      }

      Expect(env.gateway.detachSession(env.sessionId)).toEqual({ detached: 1 })
      Expect(await capture).toEqual({ error: 'The Studio project session closed.' })
      Expect((await device.rejected()).code).toBe('unknown-session')
      Expect(() => env.session.previewCellInstance(assigned.identity.previewInstanceId)).toThrow('no longer current')
      Expect(env.gateway.status(env.sessionId).connection).toBeUndefined()
    })
  })

  Test('re-assigns the device when the cell it renders is reconfigured, and leaves other cells alone', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const first = await device.nextSealed()
      const firstIdentity = first.type === 'studio.cellAssigned' ? first.identity : undefined
      Expect(firstIdentity?.cellRevision).toBe(0)

      // Reconfiguring a DIFFERENT cell must not disturb this device.
      env.session.reconfigureCell({
        appName: 'Garden',
        cellId: 'cell:tablet',
        cellRevision: 0,
        compileRevision: 1,
        environment: {
          network: { latencyMs: 0, outcome: 'offline' as const },
          scheme: systemLightScheme(),
          viewport: { height: 844, width: 390 },
        },
        manifestRevision: 'manifest-1',
        project: env.session.projectRoot,
      })

      // Reconfiguring the cell this device renders must hand it a fresh, live instance: the
      // reconfigure released the old one, so without this its next device.applied is refused.
      env.session.reconfigureCell({
        appName: 'Garden',
        cellId: 'cell:phone',
        cellRevision: 0,
        compileRevision: 1,
        environment: {
          network: { latencyMs: 0, outcome: 'offline' as const },
          scheme: systemLightScheme(),
          viewport: { height: 844, width: 390 },
        },
        manifestRevision: 'manifest-1',
        project: env.session.projectRoot,
      })
      let reassigned: TaoStudioDeviceStudioMessage | undefined
      while (reassigned?.type !== 'studio.cellAssigned') {
        reassigned = await device.nextSealed()
      }
      Expect(reassigned.identity.cellId).toBe('cell:phone')
      Expect(reassigned.identity.cellRevision).toBe(1)
      Expect(reassigned.identity.previewInstanceId).not.toBe(firstIdentity?.previewInstanceId)
      // The new environment reached the device with the assignment.
      Expect(JSON.stringify(reassigned.runtime)).toContain('offline')

      // And the instance it was handed is genuinely current: an acknowledgement is accepted.
      device.sendSealed({
        appliedRevision: 1,
        compileRevision: 1,
        identity: reassigned.identity,
        type: 'device.applied',
      })
      let ack: TaoStudioDeviceStudioMessage | undefined
      while (ack?.type !== 'studio.appliedAck') {
        ack = await device.nextSealed()
      }
      Expect(ack).toEqual({ accepted: true, compileRevision: 1, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.lastError).toBeUndefined()
    })
  })

  Test('pushes the manifest and re-registers the selected cell when a compile changes it', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:tablet', type: 'device.selectCell' })
      const first = await device.nextSealed()
      Expect(first.type === 'studio.cellAssigned' && first.identity.cellId).toBe(
        'cell:tablet',
      )

      env.cells.splice(0, env.cells.length, 'cell:phone')
      await env.session.compileInitial()
      const compiling = await device.nextSealed()
      Expect(compiling).toMatchObject({ compileRevision: 2, status: 'compiling', type: 'studio.compileState' })
      const manifest = await device.nextSealed()
      Expect(manifest).toMatchObject({ manifest: { compileRevision: 2, manifestRevision: 'manifest-2' } })
      Expect(manifest.type === 'studio.manifest' ? manifest.manifest.scenarios.map(item => item.cellId) : []).toEqual([
        'cell:phone',
      ])
      const reassigned = await device.nextSealed()
      Expect(reassigned).toMatchObject({
        identity: {
          cellId: 'cell:phone',
          compileRevision: 2,
          manifestRevision: 'manifest-2',
        },
        type: 'studio.cellAssigned',
      })
      const compileState = await device.nextSealed()
      Expect(compileState).toMatchObject({ compileRevision: 2, status: 'compiled', type: 'studio.compileState' })
      if (reassigned.type === 'studio.cellAssigned') {
        Expect(env.session.previewCellInstance(reassigned.identity.previewInstanceId).identity.compileRevision).toBe(2)
      }
      if (first.type === 'studio.cellAssigned') {
        Expect(() => env.session.previewCellInstance(first.identity.previewInstanceId)).toThrow('no longer current')
      }
    })
  })

  Test('acknowledges an ordinary app on its first connection and after reconnect without a preview cell', async () => {
    await withGateway({}, async env => {
      env.cells.splice(0)
      await env.session.compileInitial()
      const device = await pairedDevice(env)
      device.sendSealed({ compileRevision: 2, manifestRevision: 'manifest-2', type: 'device.appApplied' })
      Expect(await device.nextSealed()).toEqual({ accepted: true, compileRevision: 2, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(2)
      Expect(env.gateway.status(env.sessionId).connection?.cellId).toBeUndefined()
      Expect(env.session.compileSnapshot().appliedRevision).toBe(0)
      const reconnecting = new TestDevice(env.gateway.port, device.identity)
      await reconnecting.connect({ sessionId: env.sessionId })
      Expect(await reconnecting.nextSealed()).toMatchObject({ manifest: { scenarios: [] }, type: 'studio.welcome' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBeUndefined()
      reconnecting.sendSealed({ compileRevision: 2, manifestRevision: 'manifest-2', type: 'device.appApplied' })
      Expect(await reconnecting.nextSealed()).toEqual({ accepted: true, compileRevision: 2, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(2)
    })
  })

  Test('releases a removed last scenario and acknowledges only the current ordinary app manifest', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      const assigned = await device.nextSealed()
      Expect(assigned.type).toBe('studio.cellAssigned')
      Expect(env.gateway.status(env.sessionId).connection?.cellId).toBe('cell:phone')
      device.sendSealed({ compileRevision: 1, manifestRevision: 'manifest-1', type: 'device.appApplied' })
      Expect(await device.nextSealed()).toEqual({ accepted: false, compileRevision: 1, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBeUndefined()

      env.cells.splice(0)
      await env.session.compileInitial()
      Expect(await device.nextSealed()).toMatchObject({ status: 'compiling', type: 'studio.compileState' })
      Expect(await device.nextSealed()).toMatchObject({ manifest: { scenarios: [] }, type: 'studio.manifest' })
      Expect(await device.nextSealed()).toMatchObject({ status: 'compiled', type: 'studio.compileState' })
      Expect(env.gateway.status(env.sessionId).connection?.cellId).toBeUndefined()
      Expect(env.gateway.status(env.sessionId).connection?.scenarioLabel).toBeUndefined()
      if (assigned.type === 'studio.cellAssigned') {
        Expect(() => env.session.previewCellInstance(assigned.identity.previewInstanceId)).toThrow('no longer current')
      }
      for (
        const stale of [
          { compileRevision: 1, manifestRevision: 'manifest-1' },
          { compileRevision: 2, manifestRevision: 'manifest-1' },
          { compileRevision: 3, manifestRevision: 'manifest-2' },
        ]
      ) {
        device.sendSealed({ ...stale, type: 'device.appApplied' })
        Expect(await device.nextSealed()).toEqual({
          accepted: false,
          compileRevision: stale.compileRevision,
          type: 'studio.appliedAck',
        })
        Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBeUndefined()
      }
      device.sendSealed({ compileRevision: 2, manifestRevision: 'manifest-2', type: 'device.appApplied' })
      Expect(await device.nextSealed()).toEqual({ accepted: true, compileRevision: 2, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(2)
      Expect(env.session.compileSnapshot().appliedRevision).toBe(0)

      env.compile.failNext = true
      await env.session.compileInitial()
      Expect(await device.nextSealed()).toMatchObject({ status: 'compiling', type: 'studio.compileState' })
      Expect(await device.nextSealed()).toMatchObject({ status: 'error', type: 'studio.compileState' })
      device.sendSealed({ compileRevision: 3, manifestRevision: 'manifest-3', type: 'device.appApplied' })
      Expect(await device.nextSealed()).toEqual({ accepted: false, compileRevision: 3, type: 'studio.appliedAck' })
      Expect(env.gateway.status(env.sessionId).connection?.appliedRevision).toBe(2)

      // A new scenario is offered without restoring the obsolete device assignment.
      env.cells.push('cell:tablet')
      await env.session.compileInitial()
      Expect(await device.nextSealed()).toMatchObject({ status: 'compiling', type: 'studio.compileState' })
      Expect(await device.nextSealed()).toMatchObject({ manifest: { compileRevision: 4 }, type: 'studio.manifest' })
      Expect(await device.nextSealed()).toMatchObject({ status: 'compiled', type: 'studio.compileState' })
      device.sendSealed({ cellId: 'cell:tablet', type: 'device.selectCell' })
      Expect(await device.nextSealed()).toMatchObject({
        identity: { cellId: 'cell:tablet' },
        type: 'studio.cellAssigned',
      })
    })
  })

  Test('closes on a replayed or reordered sealed frame', async () => {
    await withGateway({}, async env => {
      const replayer = await pairedDevice(env)
      const frame = replayer.sealedFrame({ type: 'device.ping' })
      replayer.sendText(JSON.stringify(frame))
      Expect(await replayer.nextSealed()).toEqual({ type: 'studio.pong' })
      replayer.sendText(JSON.stringify(frame))
      Expect((await replayer.rejected()).code).toBe('replayed-frame')

      const skipper = new TestDevice(env.gateway.port, replayer.identity)
      await skipper.connect({ metroPort: env.metroPort })
      Expect((await skipper.nextSealed()).type).toBe('studio.welcome')
      skipper.sendSeq = 5
      skipper.sendSealed({ type: 'device.ping' })
      Expect((await skipper.rejected()).code).toBe('replayed-frame')

      const forger = new TestDevice(env.gateway.port, replayer.identity)
      await forger.connect({ metroPort: env.metroPort })
      Expect((await forger.nextSealed()).type).toBe('studio.welcome')
      const foreign = StudioDeviceTrust.deriveSession(
        'device',
        StudioDeviceTrust.generateEphemeral().secretKey,
        StudioDeviceTrust.generateEphemeral().publicKey,
        new Uint8Array(32),
      )
      forger.sendText(JSON.stringify(StudioDeviceTrust.seal(foreign, 1, { type: 'device.ping' })))
      Expect((await forger.rejected()).code).toBe('malformed')

      const shouter = new TestDevice(env.gateway.port, replayer.identity)
      await shouter.connect({ metroPort: env.metroPort })
      Expect((await shouter.nextSealed()).type).toBe('studio.welcome')
      shouter.sendText(JSON.stringify({
        ...shouter.sealedFrame({ type: 'device.ping' }),
        padding: 'x'.repeat(TaoStudioDeviceProtocol.frameLimitBytes),
      }))
      Expect((await shouter.rejected()).code).toBe('oversized')
    })
  })

  Test('routes devices to the session owning their Metro port and stops every socket', async () => {
    await withGateway({}, async env => {
      const other = await openProject('Orchard', 'tao-studio-device-other-')
      try {
        env.sessions.set('second_session', {
          previewUrl: 'http://127.0.0.1:8082',
          session: other.session,
          sessionId: 'second_session',
        })
        env.gateway.openPairing('second_session')
        const device = new TestDevice(env.gateway.port)
        await device.connect({ metroPort: 8082 })
        Expect(await device.nextSealed()).toEqual({ type: 'studio.pairingPending' })
        Expect(env.gateway.status(env.sessionId).pairing.pending).toBeUndefined()
        Expect(env.gateway.status('second_session').pairing.pending?.devicePublicKey).toBe(device.identity.publicKey)
        await env.gateway.confirmPairing('second_session', device.identity.publicKey)
        Expect(await device.nextSealed()).toMatchObject({ appName: 'Orchard', sessionId: 'second_session' })

        const first = new TestDevice(env.gateway.port, device.identity)
        await first.connect({ metroPort: env.metroPort })
        Expect(await first.nextSealed()).toMatchObject({ appName: 'Garden', sessionId: env.sessionId })
        Expect(env.gateway.status(env.sessionId).connection?.state).toBe('connected')
        Expect(env.gateway.status('second_session').connection).toBeUndefined()
        Expect((await device.rejected()).code).toBe('replaced')

        env.gateway.stop()
        Expect((await first.rejected()).code).toBe('gateway-stopped')
        Expect(env.gateway.status(env.sessionId).connection).toBeUndefined()
      } finally {
        await other.close()
      }
    })
  })
})

const fixedNow = new Date('2026-09-02T10:00:00.000Z')

type Env = {
  cells: string[]
  clock: { now: Date }
  compile: { failNext: boolean }
  gateway: StudioDeviceGateway
  metroPort: number
  session: StudioProjectSession
  sessionId: string
  sessions: Map<string, StudioDeviceGatewaySessionRef>
  store: StudioDeviceTrustStore
  trustRoot: string
}

/**
 * The canvas half of the device protocol: a tap on the phone reaches the Mac's editor, a selection
 * on the Mac reaches the phone, and an edit made on the phone is a real source edit that Studio can
 * refuse. Slice 2's acceptance calls this "select both ways".
 */
Describe('Studio device gateway canvas', () => {
  const twoRenders = `app Garden { view Main }
view Main() {
  render Stack() {
    Text("First")
    Text("Second")
  }
}
`

  Test("carries a device's tap to the workbench, once per tap", async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      await device.nextSealed()
      Expect(env.gateway.status(env.sessionId).selection).toBeUndefined()

      device.sendSealed({
        occurrence: { end: 60, ownerName: 'Main', sourcePath: '/p/Garden.tao', sourceVersion: 'v1', start: 40 },
        type: 'device.selectSource',
      })
      await until(
        () => env.gateway.status(env.sessionId).selection !== undefined,
        { description: 'the tapped occurrence' },
      )
      Expect(env.gateway.status(env.sessionId).selection).toEqual({
        end: 60,
        ownerName: 'Main',
        sequence: 1,
        sourcePath: '/p/Garden.tao',
        sourceVersion: 'v1',
        start: 40,
      })

      // The sequence is what lets the workbench tell a new tap from the same status being re-sent,
      // so a second tap on the very same render has to advance it.
      device.sendSealed({
        occurrence: { end: 60, ownerName: 'Main', sourcePath: '/p/Garden.tao', sourceVersion: 'v1', start: 40 },
        type: 'device.selectSource',
      })
      await until(
        () => env.gateway.status(env.sessionId).selection?.sequence === 2,
        { description: 'the second tap' },
      )
    })
  })

  Test('refuses an edit that claims a version of the file older than the one on the Mac', async () => {
    await withGateway({ source: twoRenders }, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      await device.nextSealed()

      const path = FS.resolvePath('Garden.tao', env.session.projectRoot)
      const booted = await env.session.readFile(path)
      const start = booted.content.indexOf('Text("Second")')
      const move = {
        action: {
          beforeId: `${path}:${booted.content.indexOf('Text("First")')}:${
            booted.content.indexOf('Text("First")') + 'Text("First")'.length
          }`,
          draggedId: `${path}:${start}:${start + 'Text("Second")'.length}`,
          kind: 'move-render' as const,
        },
        occurrence: {
          end: start + 'Text("Second")'.length,
          ownerName: 'Main',
          sourcePath: path,
          start,
        },
      }

      // An edit appended after every render: the file's version changes, and — this is what makes
      // the test discriminating — the offsets the device measured still point at the same renders.
      // The only thing wrong with the device's next request is the version it claims.
      await env.session.syncDraft({
        content: `${booted.content}\n// a note added on the Mac\n`,
        path,
        sourceVersion: booted.sourceVersion,
        writeId: 'mac-edit',
      })
      const current = await env.session.readFile(path)
      Expect(current.sourceVersion === booted.sourceVersion).toBe(false)
      Expect(current.content.indexOf('Text("Second")')).toBe(start)

      device.sendSealed({
        ...move,
        occurrence: { ...move.occurrence, sourceVersion: booted.sourceVersion },
        requestId: 'device-stale',
        type: 'device.sourceAction',
      })
      Expect(await nextSourceActionResult(device)).toMatchObject({ ok: false, requestId: 'device-stale' })
      Expect(await env.session.readFile(path)).toMatchObject({ content: current.content })

      // The same edit, claiming the version the file actually has, is applied.
      device.sendSealed({
        ...move,
        occurrence: { ...move.occurrence, sourceVersion: current.sourceVersion },
        requestId: 'device-current',
        type: 'device.sourceAction',
      })
      Expect(await nextSourceActionResult(device)).toEqual({
        ok: true,
        requestId: 'device-current',
        type: 'studio.sourceActionResult',
      })
      const moved = await env.session.readFile(path)
      Expect(moved.content.indexOf('Text("Second")')).toBeLessThan(moved.content.indexOf('Text("First")'))
    })
  })

  Test('refuses an edit from a device that is not rendering a cell', async () => {
    await withGateway({ source: twoRenders }, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({
        action: { beforeId: 'a', draggedId: 'b', kind: 'move-render' },
        occurrence: { end: 10, sourcePath: '/p/Garden.tao', sourceVersion: 'v1', start: 0 },
        requestId: 'device-1',
        type: 'device.sourceAction',
      })
      const refused = await nextSourceActionResult(device)
      Expect(refused).toEqual({
        error: 'This device is not rendering a cell.',
        ok: false,
        requestId: 'device-1',
        type: 'studio.sourceActionResult',
      })
    })
  })

  Test('puts the cell under the network condition the phone chose, and takes it back off', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: 'cell:phone', type: 'device.selectCell' })
      await device.nextSealed()

      const before = env.session.previewManifest()?.cells.find(cell => cell.cellId === 'cell:phone')?.environment
      Expect(before).toBeDefined()

      device.sendSealed({ network: 'offline', type: 'device.setNetwork' })
      const offline = await nextAssignedCell(device)
      // The condition is merged into the environment the cell is already under. Choosing Offline
      // must not also reset its scheme and viewport, which a whole-environment reconfigure would.
      Expect(env.session.previewCellInstance(offline.identity.previewInstanceId)).toMatchObject({
        cell: {
          environment: {
            network: { outcome: 'offline' },
            scheme: before?.scheme,
            viewport: before?.viewport,
          },
        },
      })

      // Choosing it again turns it off: the phone toggles a situation, it does not accumulate one.
      device.sendSealed({ network: 'normal', type: 'device.setNetwork' })
      const back = await nextAssignedCell(device)
      Expect(env.session.previewCellInstance(back.identity.previewInstanceId)).toMatchObject({
        cell: { environment: { network: { outcome: 'normal' } } },
      })
    })
  })

  Test('sends a Studio selection to the connected device and answers honestly with none connected', async () => {
    await withGateway({}, async env => {
      const occurrence = { end: 60, sourcePath: '/p/Garden.tao', sourceVersion: 'v1', start: 40 }
      Expect(env.gateway.highlightSource(env.sessionId, occurrence)).toEqual({ delivered: false })

      const device = await pairedDevice(env)
      Expect(env.gateway.highlightSource(env.sessionId, occurrence)).toEqual({ delivered: true })
      Expect(await device.nextSealed()).toEqual({ occurrence, type: 'studio.highlightSource' })

      // Clearing is its own message rather than an empty occurrence, so a cleared selection on the
      // Mac takes the outline off the phone instead of leaving a stale one.
      Expect(env.gateway.highlightSource(env.sessionId)).toEqual({ delivered: true })
      Expect(await device.nextSealed()).toEqual({ type: 'studio.highlightSource' })
    })
  })
})

/** Reads sealed frames until the device is assigned a cell again, which a reconfigure causes. */
async function nextAssignedCell(
  device: TestDevice,
): Promise<Extract<TaoStudioDeviceStudioMessage, { type: 'studio.cellAssigned' }>> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const message = await device.nextSealed()
    if (message.type === 'studio.cellAssigned') {
      return message
    }
  }
  Errors.throwUnexpected('The gateway never re-assigned the device after a network change.')
}

/** Reads sealed frames until the device's edit is answered; compile state interleaves with it. */
async function nextSourceActionResult(device: TestDevice): Promise<TaoStudioDeviceStudioMessage> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const message = await device.nextSealed()
    if (message.type === 'studio.sourceActionResult') {
      return message
    }
  }
  Errors.throwUnexpected('The gateway never answered the device source action.')
}

async function withGateway(
  options:
    & Partial<
      Pick<StudioDeviceGatewayOptions, 'bonjour' | 'handshakeTimeoutMs' | 'pairingWindowMs' | 'trustRefreshMs'>
    >
    & { source?: string },
  use: (env: Env) => Promise<void>,
): Promise<void> {
  const project = await openProject('Garden', 'tao-studio-device-', options.source)
  const trustRoot = await mkTestDir('tao-studio-device-trust-')
  const sessions = new Map<string, StudioDeviceGatewaySessionRef>()
  sessions.set('first_session', {
    previewUrl: 'http://127.0.0.1:8081',
    session: project.session,
    sessionId: 'first_session',
  })
  const store = await StudioDeviceTrustStore.open(trustRoot)
  const clock = { now: fixedNow }
  const gateway = await StudioDeviceGateway.start({
    ...options,
    bonjour: options.bonjour ?? false,
    hostname: '127.0.0.1',
    hosts: async () => ['192.168.1.20'],
    now: () => clock.now,
    sessions: { get: sessionId => sessions.get(sessionId), list: () => [...sessions.values()] },
    trustStore: store,
  })
  try {
    await use({
      cells: project.cells,
      clock,
      compile: project.compile,
      gateway,
      metroPort: 8081,
      session: project.session,
      sessionId: 'first_session',
      sessions,
      store,
      trustRoot,
    })
  } finally {
    gateway.stop()
    await store.flush()
    await project.close()
    await FS.remove(trustRoot)
  }
}

async function openProject(
  appName: string,
  prefix: string,
  source?: string,
): Promise<{
  cells: string[]
  close: () => Promise<void>
  compile: { failNext: boolean }
  session: StudioProjectSession
}> {
  const root = await mkTestDir(prefix, { location: 'host' })
  await FS.writeText(
    FS.resolvePath('Project.tao', root),
    `project { id "tao-studio-device-${appName.toLowerCase()}" name "${appName}" }`,
  )
  await FS.writeText(
    FS.resolvePath(`${appName}.tao`, root),
    source ?? `app ${appName} { view Main }\nview Main() { render Text("${appName}") }\n`,
  )
  const cells = ['cell:phone', 'cell:tablet']
  // A failing compile still advances the coordinator's compileRevision but never publishes a
  // manifest, which is the state a device must not be able to claim as applied.
  const compile = { failNext: false }
  let session: StudioProjectSession | undefined
  session = await StudioProjectSession.open({
    async compile(request) {
      if (compile.failNext) {
        compile.failNext = false
        Errors.throwUserInput(`Compile of revision ${request.compileRevision} failed on purpose.`)
      }
      session?.setMatrixManifest(manifestFor(session, request.compileRevision, cells))
    },
    entryPath: `${appName}.tao`,
    projectRoot: root,
  })
  await session.compileInitial()
  return {
    cells,
    async close() {
      await FS.remove(root)
    },
    compile,
    session,
  }
}

function manifestFor(
  session: StudioProjectSession,
  compileRevision: number,
  cells: readonly string[],
): StudioPreviewManifestV2 {
  const source = { kind: 'tao' as const, path: `${session.appName}.tao`, range: { end: 10, start: 0 } }
  const environment = (width: number, height: number) => ({
    network: { latencyMs: 0, outcome: 'normal' as const },
    scheme: systemLightScheme(),
    viewport: { height, width },
  })
  return {
    capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' },
    cells: cells.map(cellId => ({
      args: {},
      cellId,
      cellRevision: 0,
      environment: cellId === 'cell:phone' ? environment(390, 844) : environment(834, 1194),
      scenarioId: `${session.appName}.phone`,
      stateLayers: [],
    })),
    compileRevision,
    fixtures: [{ fixtureId: 'fixture:base', label: 'Base', plan: {}, source }],
    generationDeclarations: [],
    manifestRevision: `manifest-${compileRevision}`,
    parametersBySubject: { [`app:${session.appName}`]: [] },
    project: { appName: session.appName, entryPath: `${session.appName}.tao`, root: session.projectRoot },
    scenarios: [{
      args: {},
      fixtureId: 'fixture:base',
      group: session.appName,
      label: `${session.appName} phone`,
      prepare: [],
      scenarioId: `${session.appName}.phone`,
      source,
      stateLayers: [],
      subjectId: `app:${session.appName}`,
    }],
    sourceVersions: { [`${session.appName}.tao`]: 'text-v1:test' },
    states: [],
    subjects: [{ appName: session.appName, kind: 'app', source, subjectId: `app:${session.appName}` }],
    version: 2,
  }
}

/** pairedDevice runs one full pairing so a test can start from a welcomed, trusted connection. */
async function pairedDevice(env: Env): Promise<TestDevice> {
  env.gateway.openPairing(env.sessionId)
  const device = new TestDevice(env.gateway.port)
  await device.connect({ metroPort: env.metroPort })
  Expect(await device.nextSealed()).toEqual({ type: 'studio.pairingPending' })
  await env.gateway.confirmPairing(env.sessionId, device.identity.publicKey)
  Expect((await device.nextSealed()).type).toBe('studio.welcome')
  return device
}

function hello(env: Env, target: { metroPort?: number; sessionId?: string }): Record<string, unknown> {
  const identity = StudioDeviceTrust.generateIdentity()
  return {
    device: { model: 'iPhone17,1', name: 'example-phone', os: 'iOS 26' },
    devicePublicKey: identity.publicKey,
    ephemeralPublicKey: StudioDeviceTrust.generateEphemeral().publicKey,
    ...(Object.keys(target).length === 0 ? { metroPort: env.metroPort } : target),
    nonce: StudioDeviceTrust.generateNonce(),
    protocol: TaoStudioDeviceProtocol.name,
    type: 'device.hello',
  }
}

type Incoming =
  | { code: number; kind: 'close'; reason: string }
  | { kind: 'clear'; message: TaoStudioDeviceClearMessage | undefined; raw: string }
  | { kind: 'sealed'; message: unknown }

/** TestDevice is the phone side of tao-studio-device-v1, written against the trust primitives only. */
class TestDevice {
  readonly description = { model: 'iPhone17,1', name: 'example-phone', os: 'iOS 26' }
  keys: TaoStudioDeviceSessionKeys | undefined
  lastConfirm: string | undefined
  receiveSeq = 1
  sendSeq = 0
  #closed: { code: number; reason: string } | undefined
  #queue: Incoming[] = []
  #socket: WebSocket | undefined
  #waiters: Array<(item: Incoming) => void> = []

  constructor(readonly port: number, readonly identity = StudioDeviceTrust.generateIdentity()) {}

  async open(): Promise<void> {
    const socket = new WebSocket(`ws://127.0.0.1:${this.port}/device`)
    this.#socket = socket
    socket.onmessage = event => this.#receive(String(event.data))
    socket.onclose = event => this.#push({ code: event.code, kind: 'close', reason: event.reason })
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Errors.HostEnvironmentError('The device socket could not open.'))
    })
  }

  async sendHello(
    target: { metroPort?: number; sessionId?: string },
  ): Promise<{ ephemeralPublicKey: string; nonce: string; secretKey: Uint8Array }> {
    if (this.#socket === undefined) {
      await this.open()
    }
    const ephemeral = StudioDeviceTrust.generateEphemeral()
    const nonce = StudioDeviceTrust.generateNonce()
    this.sendText(JSON.stringify({
      device: this.description,
      devicePublicKey: this.identity.publicKey,
      ephemeralPublicKey: ephemeral.publicKey,
      ...target,
      nonce,
      protocol: TaoStudioDeviceProtocol.name,
      type: 'device.hello',
    }))
    return { ephemeralPublicKey: ephemeral.publicKey, nonce, secretKey: ephemeral.secretKey }
  }

  /** connect completes the handshake exactly as the contract describes and returns Studio's hello. */
  async connect(target: { metroPort?: number; sessionId?: string }): Promise<TaoStudioDeviceStudioHelloMessage> {
    const ephemeral = await this.sendHello(target)
    const incoming = await this.next()
    if (incoming.kind !== 'clear' || incoming.message?.type !== 'studio.hello') {
      Errors.throwUnexpected(`Expected studio.hello but received ${JSON.stringify(incoming)}`)
    }
    const studioHello = incoming.message
    const transcript = StudioDeviceTrust.transcript({
      deviceEphemeralPublicKey: ephemeral.ephemeralPublicKey,
      deviceNonce: ephemeral.nonce,
      devicePublicKey: this.identity.publicKey,
      sessionId: target.sessionId ?? '',
      studioEphemeralPublicKey: studioHello.ephemeralPublicKey,
      studioNonce: studioHello.nonce,
      studioPublicKey: studioHello.studioPublicKey,
    })
    Expect(StudioDeviceTrust.verify('studio', transcript, studioHello.signature, studioHello.studioPublicKey)).toBe(
      true,
    )
    this.keys = StudioDeviceTrust.deriveSession(
      'device',
      ephemeral.secretKey,
      studioHello.ephemeralPublicKey,
      transcript,
    )
    this.lastConfirm = StudioDeviceTrust.sign('device', transcript, this.identity)
    this.sendText(JSON.stringify({ signature: this.lastConfirm, type: 'device.confirm' }))
    return studioHello
  }

  sendText(text: string): void {
    this.#socket!.send(text)
  }

  sealedFrame(message: unknown): ReturnType<typeof StudioDeviceTrust.seal> {
    this.sendSeq += 1
    return StudioDeviceTrust.seal(this.keys!, this.sendSeq, message)
  }

  sendSealed(message: unknown): void {
    this.sendText(JSON.stringify(this.sealedFrame(message)))
  }

  close(): void {
    this.#socket?.close()
  }

  next(): Promise<Incoming> {
    const queued = this.#queue.shift()
    if (queued !== undefined) {
      return Promise.resolve(queued)
    }
    if (this.#closed !== undefined) {
      return Promise.resolve({ ...this.#closed, kind: 'close' })
    }
    return new Promise<Incoming>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Errors.UnexpectedBehaviorError('Timed out waiting for the next device frame.')),
        3_000,
      )
      this.#waiters.push(item => {
        clearTimeout(timer)
        resolve(item)
      })
    })
  }

  async nextSealed(): Promise<TaoStudioDeviceStudioMessage> {
    const incoming = await this.next()
    if (incoming.kind !== 'sealed') {
      Errors.throwUnexpected(`Expected a sealed frame but received ${JSON.stringify(incoming)}`)
    }
    const message = StudioDeviceProtocol.parseStudioMessage(incoming.message)
    if (message === undefined) {
      Errors.throwUnexpected(`Studio sent an unparseable sealed message: ${JSON.stringify(incoming.message)}`)
    }
    return message
  }

  /** rejected reads the clear studio.rejected frame and the close that must follow it. */
  async rejected(): Promise<{ closeCode: number; code: TaoStudioDeviceRejectCode; message: string }> {
    const incoming = await this.next()
    if (incoming.kind !== 'clear' || incoming.message?.type !== 'studio.rejected') {
      Errors.throwUnexpected(`Expected studio.rejected but received ${JSON.stringify(incoming)}`)
    }
    const close = await this.next()
    if (close.kind !== 'close') {
      Errors.throwUnexpected(`Expected the socket to close after studio.rejected but received ${JSON.stringify(close)}`)
    }
    Expect(close.reason).toBe(incoming.message.code)
    return { closeCode: close.code, code: incoming.message.code, message: incoming.message.message }
  }

  #receive(raw: string): void {
    const parsed = StudioDeviceProtocol.parseText(raw, TaoStudioDeviceProtocol.frameLimitBytes)
    const message = parsed.kind === 'json' ? StudioDeviceProtocol.parseClearMessage(parsed.value) : undefined
    if (message?.type === 'sealed' && this.keys !== undefined) {
      const opened = StudioDeviceTrust.open(this.keys, this.receiveSeq, message)
      this.receiveSeq += 1
      this.#push({ kind: 'sealed', message: opened })
      return
    }
    this.#push({ kind: 'clear', message, raw })
  }

  #push(item: Incoming): void {
    if (item.kind === 'close') {
      this.#closed = { code: item.code, reason: item.reason }
    }
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      waiter(item)
    } else {
      this.#queue.push(item)
    }
  }
}
