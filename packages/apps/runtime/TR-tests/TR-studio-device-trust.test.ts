import { Describe, Expect, Test } from '@shared/test'
import {
  StudioDeviceProtocol,
  TaoStudioDeviceProtocol,
  type TaoStudioDeviceSealedFrame,
} from '../TaoRuntime-src/TR-studio-device-protocol'
import {
  StudioDeviceTrust,
  StudioDeviceTrustError,
  type TaoStudioDeviceTranscriptInput,
} from '../TaoRuntime-src/TR-studio-device-trust'

/** Runs both halves of one handshake so a test can reason about the derived material. */
function handshake(sessionId = 'session-1') {
  const studio = StudioDeviceTrust.generateIdentity()
  const device = StudioDeviceTrust.generateIdentity()
  const studioEphemeral = StudioDeviceTrust.generateEphemeral()
  const deviceEphemeral = StudioDeviceTrust.generateEphemeral()
  const input: TaoStudioDeviceTranscriptInput = {
    deviceEphemeralPublicKey: deviceEphemeral.publicKey,
    deviceNonce: StudioDeviceTrust.generateNonce(),
    devicePublicKey: device.publicKey,
    sessionId,
    studioEphemeralPublicKey: studioEphemeral.publicKey,
    studioNonce: StudioDeviceTrust.generateNonce(),
    studioPublicKey: studio.publicKey,
  }
  const transcript = StudioDeviceTrust.transcript(input)
  return {
    device,
    deviceKeys: StudioDeviceTrust.deriveSession(
      'device',
      deviceEphemeral.secretKey,
      studioEphemeral.publicKey,
      transcript,
    ),
    input,
    studio,
    studioKeys: StudioDeviceTrust.deriveSession(
      'studio',
      studioEphemeral.secretKey,
      deviceEphemeral.publicKey,
      transcript,
    ),
    transcript,
  }
}

Describe('Studio device trust primitives', () => {
  Test('both sides derive the same code and mirrored direction keys', () => {
    const run = handshake()

    Expect(run.deviceKeys.code).toBe(run.studioKeys.code)
    Expect(run.deviceKeys.code).toMatch(/^\d{6}$/)
    Expect(StudioDeviceTrust.formatCode(run.deviceKeys.code)).toBe(
      `${run.deviceKeys.code.slice(0, 3)} ${run.deviceKeys.code.slice(3)}`,
    )
    Expect(Array.from(run.deviceKeys.sendKey)).toEqual(Array.from(run.studioKeys.receiveKey))
    Expect(Array.from(run.studioKeys.sendKey)).toEqual(Array.from(run.deviceKeys.receiveKey))
    Expect(Array.from(run.deviceKeys.sendKey)).not.toEqual(Array.from(run.deviceKeys.receiveKey))
  })

  Test('a man in the middle sees a different code on each side', () => {
    const honest = handshake()
    const attackerEphemeral = StudioDeviceTrust.generateEphemeral()
    const seenByDevice = StudioDeviceTrust.transcript({
      ...honest.input,
      studioEphemeralPublicKey: attackerEphemeral.publicKey,
    })
    const deviceEphemeral = StudioDeviceTrust.generateEphemeral()
    const deviceView = StudioDeviceTrust.deriveSession(
      'device',
      deviceEphemeral.secretKey,
      attackerEphemeral.publicKey,
      seenByDevice,
    )
    // The key material carries the proof: different transcripts and different shared secrets cannot
    // derive the same direction keys, so this holds at 2^-256 rather than the code's one in a
    // million. The code is what a person actually compares, so it is asserted too — a six-digit SAS
    // genuinely can collide by chance, which is a property of the scheme, not of this test.
    Expect(Array.from(seenByDevice)).not.toEqual(Array.from(honest.transcript))
    Expect(Array.from(deviceView.sendKey)).not.toEqual(Array.from(honest.studioKeys.receiveKey))
    Expect(Array.from(deviceView.receiveKey)).not.toEqual(Array.from(honest.studioKeys.sendKey))
    Expect(honest.studioKeys.code).not.toBe(deviceView.code)
  })

  Test('signatures bind a role to the transcript and fail for any other key, role, or transcript', () => {
    const run = handshake()
    const signature = StudioDeviceTrust.sign('studio', run.transcript, run.studio)

    Expect(StudioDeviceTrust.verify('studio', run.transcript, signature, run.studio.publicKey)).toBe(true)
    Expect(StudioDeviceTrust.verify('device', run.transcript, signature, run.studio.publicKey)).toBe(false)
    Expect(StudioDeviceTrust.verify('studio', run.transcript, signature, run.device.publicKey)).toBe(false)
    Expect(StudioDeviceTrust.verify('studio', handshake().transcript, signature, run.studio.publicKey)).toBe(false)
    Expect(StudioDeviceTrust.verify('studio', run.transcript, 'not base64!', run.studio.publicKey)).toBe(false)
  })

  Test('a replayed handshake changes the transcript because nonces and ephemerals are fresh', () => {
    const first = handshake()
    const second = handshake()

    Expect(Array.from(first.transcript)).not.toEqual(Array.from(second.transcript))
    Expect(StudioDeviceTrust.transcript({ ...first.input, sessionId: 'session-2' })).not.toEqual(first.transcript)
  })

  Test('sealed frames round-trip in order and reject replay, reordering, tampering, and wrong keys', () => {
    const run = handshake()
    const first = StudioDeviceTrust.seal(run.studioKeys, 1, { type: 'studio.pong' })
    const second = StudioDeviceTrust.seal(run.studioKeys, 2, { type: 'studio.reconnect' })

    Expect(StudioDeviceTrust.open(run.deviceKeys, 1, first)).toEqual({ type: 'studio.pong' })
    Expect(StudioDeviceTrust.open(run.deviceKeys, 2, second)).toEqual({ type: 'studio.reconnect' })
    Expect(() => StudioDeviceTrust.open(run.deviceKeys, 3, first)).toThrow(StudioDeviceTrustError)
    Expect(() => StudioDeviceTrust.open(run.deviceKeys, 1, second)).toThrow(StudioDeviceTrustError)
    const tampered: TaoStudioDeviceSealedFrame = {
      ...first,
      box: first.box.replace(/^./, char => (char === 'A' ? 'B' : 'A')),
    }
    Expect(() => StudioDeviceTrust.open(run.deviceKeys, 1, tampered)).toThrow(StudioDeviceTrustError)
    const relabeled: TaoStudioDeviceSealedFrame = { ...second, seq: 1 }
    Expect(() => StudioDeviceTrust.open(run.deviceKeys, 1, relabeled)).toThrow(StudioDeviceTrustError)
    // The device's own send key cannot open a Studio frame: directions are distinct.
    Expect(() => StudioDeviceTrust.open(run.studioKeys, 1, first)).toThrow(StudioDeviceTrustError)
    let code: string | undefined
    try {
      StudioDeviceTrust.open(run.deviceKeys, 5, first)
    } catch (error) {
      code = error instanceof StudioDeviceTrustError ? error.code : undefined
    }
    Expect(code).toBe('replayed-frame')
  })

  Test('identities, fingerprints, and base64 stay consistent', () => {
    const identity = StudioDeviceTrust.generateIdentity()

    Expect(StudioDeviceTrust.publicKeyOf(identity)).toBe(identity.publicKey)
    Expect(StudioDeviceTrust.validPublicKey(identity.publicKey)).toBe(true)
    Expect(StudioDeviceTrust.validPublicKey('short')).toBe(false)
    // A nonce is 16 bytes, not a key's 32, and not merely "some bytes".
    Expect(StudioDeviceTrust.validNonce(StudioDeviceTrust.generateNonce())).toBe(true)
    Expect(StudioDeviceTrust.validNonce('c2hvcnQ=')).toBe(false)
    Expect(StudioDeviceTrust.validNonce(identity.publicKey)).toBe(false)
    Expect(StudioDeviceTrust.validNonce('')).toBe(false)
    Expect(StudioDeviceTrust.validNonce('not base64!')).toBe(false)
    Expect(StudioDeviceTrust.fingerprint(identity.publicKey)).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/)
    Expect(StudioDeviceTrust.fingerprint(identity.publicKey)).toBe(StudioDeviceTrust.fingerprint(identity.publicKey))
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    Expect(Array.from(StudioDeviceTrust.base64Decode(StudioDeviceTrust.base64Encode(bytes)))).toEqual(Array.from(bytes))
    Expect(StudioDeviceTrust.base64Encode(new Uint8Array([104, 105]))).toBe('aGk=')
  })
})

Describe('Studio device protocol parsers', () => {
  const hello = {
    device: { model: 'iPhone17,1', name: 'roPhone', os: 'iOS 26.6.1' },
    devicePublicKey: 'a'.repeat(43) + '=',
    ephemeralPublicKey: 'b'.repeat(43) + '=',
    metroPort: 8081,
    nonce: 'c'.repeat(22) + '==',
    protocol: TaoStudioDeviceProtocol.name,
    type: 'device.hello',
  }

  Test('accepts a complete hello and rejects a wrong protocol, port, or missing key', () => {
    Expect(StudioDeviceProtocol.parseClearMessage(hello)).toEqual(hello)
    Expect(StudioDeviceProtocol.parseClearMessage({ ...hello, protocol: 'tao-studio-device-v2' })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage({ ...hello, metroPort: 70_000 })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage({ ...hello, devicePublicKey: '' })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage({ ...hello, device: { name: '' } })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage({ type: 'device.hello' })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage('device.hello')).toBeUndefined()
  })

  Test('parses the remaining clear frames strictly', () => {
    Expect(StudioDeviceProtocol.parseClearMessage({ signature: 'sig', type: 'device.confirm' })).toEqual({
      signature: 'sig',
      type: 'device.confirm',
    })
    Expect(StudioDeviceProtocol.parseClearMessage({ code: 'revoked', message: 'gone', type: 'studio.rejected' }))
      .toEqual({ code: 'revoked', message: 'gone', type: 'studio.rejected' })
    Expect(StudioDeviceProtocol.parseClearMessage({ code: 'made-up', message: 'x', type: 'studio.rejected' }))
      .toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage({ box: 'b', nonce: 'n', seq: 0, type: 'sealed' })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseClearMessage({ box: 'b', nonce: 'n', seq: 1, type: 'sealed' })).toEqual({
      box: 'b',
      nonce: 'n',
      seq: 1,
      type: 'sealed',
    })
    Expect(StudioDeviceProtocol.parseClearMessage({ type: 'device.selectCell', cellId: 'c' })).toBeUndefined()
  })

  Test('parses sealed control messages and drops unknown or incomplete ones', () => {
    const identity = {
      appName: 'WordFlower',
      cellId: 'states#cell',
      cellRevision: 0,
      compileRevision: 3,
      manifestRevision: 'compile:3',
      previewInstanceId: 'instance-1',
    }
    Expect(StudioDeviceProtocol.parseDeviceMessage({
      appliedRevision: 3,
      compileRevision: 3,
      identity,
      type: 'device.applied',
    })).toEqual({ appliedRevision: 3, compileRevision: 3, identity, type: 'device.applied' })
    Expect(StudioDeviceProtocol.parseDeviceMessage({
      appliedRevision: 3,
      compileRevision: 3,
      identity: { ...identity, previewInstanceId: '' },
      type: 'device.applied',
    })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseDeviceMessage({ type: 'device.selectCell' })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseDeviceMessage({ type: 'device.ping', extra: true })).toEqual({
      type: 'device.ping',
    })
    Expect(StudioDeviceProtocol.parseDeviceMessage({ type: 'studio.pong' })).toBeUndefined()

    const manifest = {
      compileRevision: 3,
      manifestRevision: 'compile:3',
      scenarios: [{
        cellId: 'states#cell',
        cellRevision: 0,
        group: 'states',
        label: 'novel',
        scenarioId: 'states',
        viewport: { height: 844, width: 390 },
      }],
    }
    Expect(StudioDeviceProtocol.parseStudioMessage({ manifest, type: 'studio.manifest' })).toEqual({
      manifest,
      type: 'studio.manifest',
    })
    Expect(StudioDeviceProtocol.parseStudioMessage({
      manifest: { ...manifest, scenarios: [{ cellId: 'x' }] },
      type: 'studio.manifest',
    })).toBeUndefined()
    Expect(
      StudioDeviceProtocol.parseStudioMessage({
        appName: 'WordFlower',
        capabilities: ['render'],
        compile: { appliedRevision: 2, compileRevision: 3, message: 'ok', status: 'compiled' },
        heartbeatMs: 15_000,
        projectLabel: 'WordFlower',
        sessionId: 's',
        type: 'studio.welcome',
      })?.type,
    ).toBe('studio.welcome')
    Expect(StudioDeviceProtocol.parseStudioMessage({
      appName: 'WordFlower',
      capabilities: ['render'],
      compile: { appliedRevision: 2, compileRevision: 3, message: 'ok', status: 'exploded' },
      heartbeatMs: 15_000,
      projectLabel: 'WordFlower',
      sessionId: 's',
      type: 'studio.welcome',
    })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseStudioMessage({ identity, runtime: { cell: {} }, type: 'studio.cellAssigned' }))
      .toEqual({ identity, runtime: { cell: {} }, type: 'studio.cellAssigned' })
    Expect(StudioDeviceProtocol.parseStudioMessage({ identity, type: 'studio.cellAssigned' })).toBeUndefined()
    Expect(StudioDeviceProtocol.parseStudioMessage({ reason: 'by hand', type: 'studio.revoked' })).toEqual({
      reason: 'by hand',
      type: 'studio.revoked',
    })
  })

  Test('measures frames in UTF-8 bytes against the limit', () => {
    Expect(StudioDeviceProtocol.utf8ByteLength('abc')).toBe(3)
    Expect(StudioDeviceProtocol.utf8ByteLength('é€😀')).toBe(2 + 3 + 4)
    Expect(StudioDeviceProtocol.parseText('{"type":"device.ping"}', 64)).toEqual({
      kind: 'json',
      value: { type: 'device.ping' },
    })
    Expect(StudioDeviceProtocol.parseText('{"type":"device.ping"}', 8)).toEqual({ kind: 'oversized' })
    Expect(StudioDeviceProtocol.parseText('{oops', 64)).toEqual({ kind: 'invalid' })
  })
})
