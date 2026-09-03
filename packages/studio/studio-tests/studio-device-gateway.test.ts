import {
  StudioDeviceProtocol,
  type TaoStudioDeviceClearMessage,
  TaoStudioDeviceProtocol,
  type TaoStudioDeviceRejectCode,
  type TaoStudioDeviceStudioHelloMessage,
  type TaoStudioDeviceStudioMessage,
} from '@runtime/TR-studio-device-protocol'
import { StudioDeviceTrust, type TaoStudioDeviceSessionKeys } from '@runtime/TR-studio-device-trust'
import { Errors, FS } from '@shared'
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

Describe('Studio device gateway handshake', () => {
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
      // cellId and scenarioId cross the device gateway opaque — see StudioDeviceGateway's
      // deviceManifest — since Studio's real ids embed the project's absolute source path.
      Expect(welcome.type === 'studio.welcome' ? welcome.manifest : undefined).toEqual({
        compileRevision: 1,
        manifestRevision: 'manifest-1',
        scenarios: [
          {
            cellId: StudioDeviceTrust.opaqueId('cell:phone'),
            cellRevision: 0,
            group: 'Garden',
            label: 'Garden phone',
            scenarioId: StudioDeviceTrust.opaqueId('Garden.phone'),
            viewport: { height: 844, width: 390 },
          },
          {
            cellId: StudioDeviceTrust.opaqueId('cell:tablet'),
            cellRevision: 0,
            group: 'Garden',
            label: 'Garden phone',
            scenarioId: StudioDeviceTrust.opaqueId('Garden.phone'),
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
        ['short device key', { ...hello(env, {}), devicePublicKey: 'c2hvcnQ=' }, 'malformed'],
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
      // A real device only ever has the opaque id the manifest gave it (see deviceManifest).
      device.sendSealed({ cellId: StudioDeviceTrust.opaqueId('cell:phone'), type: 'device.selectCell' })
      const assigned = await device.nextSealed()
      Expect(assigned.type).toBe('studio.cellAssigned')
      if (assigned.type !== 'studio.cellAssigned') {
        return
      }
      Expect(assigned.identity).toMatchObject({
        appName: 'Garden',
        cellId: StudioDeviceTrust.opaqueId('cell:phone'),
        cellRevision: 0,
        compileRevision: 1,
        manifestRevision: 'manifest-1',
      })
      Expect(assigned.runtime).toEqual(env.session.previewCellInstance(assigned.identity.previewInstanceId))
      Expect(env.gateway.status(env.sessionId).connection).toMatchObject({
        cellId: 'cell:phone',
        scenarioLabel: 'Garden phone',
      })

      device.sendSealed({ cellId: StudioDeviceTrust.opaqueId('cell:tablet'), type: 'device.selectCell' })
      const reassigned = await device.nextSealed()
      Expect(reassigned.type === 'studio.cellAssigned' && reassigned.identity.cellId).toBe(
        StudioDeviceTrust.opaqueId('cell:tablet'),
      )
      // A device renders one cell at a time, so selecting another releases its previous instance.
      Expect(() => env.session.previewCellInstance(assigned.identity.previewInstanceId)).toThrow('no longer current')

      // Studio-initiated (the browser workbench) always supplies its own real, internal id — #assign
      // still opaque-wraps whatever it sends the device with, regardless of who triggered it.
      Expect(env.gateway.selectCell(env.sessionId, 'cell:phone')).toEqual({ requested: true })
      const fromStudio = await device.nextSealed()
      Expect(fromStudio.type === 'studio.cellAssigned' && fromStudio.identity.cellId).toBe(
        StudioDeviceTrust.opaqueId('cell:phone'),
      )
      Expect(() => env.session.previewCellInstance(assigned.identity.previewInstanceId)).toThrow('no longer current')
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

      // An id with no match in the current manifest — garbage, or one from a manifest since replaced
      // — reaches #assign untranslated and is echoed back the same way every #assign reply is: opaque.
      device.sendSealed({ cellId: 'cell:missing', type: 'device.selectCell' })
      Expect(await device.nextSealed()).toMatchObject({
        cellId: StudioDeviceTrust.opaqueId('cell:missing'),
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

  Test('pushes the manifest and re-registers the selected cell when a compile changes it', async () => {
    await withGateway({}, async env => {
      const device = await pairedDevice(env)
      device.sendSealed({ cellId: StudioDeviceTrust.opaqueId('cell:tablet'), type: 'device.selectCell' })
      const first = await device.nextSealed()
      Expect(first.type === 'studio.cellAssigned' && first.identity.cellId).toBe(
        StudioDeviceTrust.opaqueId('cell:tablet'),
      )

      env.cells.splice(0, env.cells.length, 'cell:phone')
      await env.session.compileInitial()
      const compiling = await device.nextSealed()
      Expect(compiling).toMatchObject({ compileRevision: 2, status: 'compiling', type: 'studio.compileState' })
      const manifest = await device.nextSealed()
      Expect(manifest).toMatchObject({ manifest: { compileRevision: 2, manifestRevision: 'manifest-2' } })
      Expect(manifest.type === 'studio.manifest' ? manifest.manifest.scenarios.map(item => item.cellId) : []).toEqual([
        StudioDeviceTrust.opaqueId('cell:phone'),
      ])
      const reassigned = await device.nextSealed()
      Expect(reassigned).toMatchObject({
        identity: {
          cellId: StudioDeviceTrust.opaqueId('cell:phone'),
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
  gateway: StudioDeviceGateway
  metroPort: number
  session: StudioProjectSession
  sessionId: string
  sessions: Map<string, StudioDeviceGatewaySessionRef>
  store: StudioDeviceTrustStore
}

async function withGateway(
  options: Partial<Pick<StudioDeviceGatewayOptions, 'handshakeTimeoutMs' | 'pairingWindowMs'>>,
  use: (env: Env) => Promise<void>,
): Promise<void> {
  const project = await openProject('Garden', 'tao-studio-device-')
  const trustRoot = await mkTestDir(FS.resolvePath('tao-studio-device-trust-', FS.tmpdir()))
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
      gateway,
      metroPort: 8081,
      session: project.session,
      sessionId: 'first_session',
      sessions,
      store,
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
): Promise<{ cells: string[]; close: () => Promise<void>; session: StudioProjectSession }> {
  const root = await mkTestDir(FS.resolvePath(prefix, FS.tmpdir()))
  await FS.writeText(
    FS.resolvePath('Project.tao', root),
    `project { id "tao-studio-device-${appName.toLowerCase()}" name "${appName}" }`,
  )
  await FS.writeText(
    FS.resolvePath(`${appName}.tao`, root),
    `app ${appName} { view Main }\nview Main() { render Text("${appName}") }\n`,
  )
  const cells = ['cell:phone', 'cell:tablet']
  let session: StudioProjectSession | undefined
  session = await StudioProjectSession.open({
    async compile(request) {
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
    scheme: {
      capability: 'reactive-browser' as const,
      requested: 'system' as const,
      resolved: 'light' as const,
      source: 'system' as const,
    },
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
    device: { model: 'iPhone17,1', name: 'roPhone', os: 'iOS 26' },
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
  readonly description = { model: 'iPhone17,1', name: 'roPhone', os: 'iOS 26' }
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
