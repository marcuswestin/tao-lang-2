import { MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'
import { Expect, mkTestDir, runCleanups, Test, until } from '@shared/test'
import { StudioMac2TestRun } from '../studio-tooling-src/StudioMac2TestRun'
import { StudioNativeTestRun } from '../studio-tooling-src/StudioNativeTestRun'
import { StudioWdaRegistration } from '../studio-tooling-src/StudioWdaRegistration'

/** Fixed visible engineering route: two real Xcode runners, no backend, Appium, or input. */
Test('real Xcode denies the original Unix transport and acknowledges the exact signed socket grant', async () => {
  const artifactBase = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? Repo.resolvePath('.artifacts/tests/studio-smoke/wda-registration-only')
  for (const phase of ['deny', 'grant'] as const) {
    const { root } = await StudioNativeTestRun.create(FS.resolvePath(phase, artifactBase))
    const containerDirectory = FS.resolvePath('Library/Containers', FS.homeDir())
    const containerBaseline = await FS.listDir(containerDirectory)
    await FS.writeJson(FS.resolvePath('container-inventory.json', root), {
      baseline: containerBaseline,
      state: 'recorded-before-xcode',
      ownership: 'shared or unknown; preserve every runner container',
    })
    let backendRequests = 0
    const run = await StudioMac2TestRun.prepare({
      artifactRoot: root,
      registrationOnly: phase,
      fetch: async () => {
        backendRequests++
        return Errors.throwUnexpected('Registration-only probe contacted backend HTTP.')
      },
    })
    let desktop: Awaited<ReturnType<typeof run.desktopLeases.acquire>> | undefined
    let primaryFailure: { error: unknown } | undefined
    let signedBaseline: Record<string, unknown> | undefined
    try {
      if (phase === 'deny') {
        await Expect(run.desktopLeases.acquire()).rejects.toThrow(/before WDA registration acknowledgement/)
        const log = await FS.readText(FS.resolvePath('appium-mac2/wda.log', root))
        Expect(log.includes('WDA launch registration failure category=channel-connect')).toBe(true)
        // Darwin EPERM is fixed numeric evidence, without a private path or environment value.
        Expect(log.includes('WDA launch registration connect errno=1')).toBe(true)
        const record = await FS.readJson<{ registration?: unknown }>(FS.resolvePath('appium-mac2/isolation.json', root))
        Expect(record.registration === undefined).toBe(true)
      } else {
        desktop = await run.desktopLeases.acquire()
        const record = await FS.readJson<
          {
            state: string
            registration: {
              signedChannelRule: boolean
              bundleDigest: string
              signedXcodeBaseline: boolean
              signedBaselineDigest: string
            }
            processes: TrackedProcess[]
          }
        >(FS.resolvePath('appium-mac2/isolation.json', root))
        Expect(record.state).toBe('registration-only-acknowledged')
        Expect(record.registration.signedChannelRule).toBe(true)
        Expect(record.registration.signedXcodeBaseline).toBe(true)
        Expect(record.registration.signedBaselineDigest).toBe(
          Platform.sha256Hex(['(allow hid-control)\n(allow signal)\n']),
        )
        Expect(/^[a-f0-9]{64}$/.test(record.registration.bundleDigest)).toBe(true)
        Expect(record.processes.some(value => value.command === 'registered WDA runner')).toBe(true)
        await until(() => run.registrationOnlyReplayComplete(), {
          description: 'owned Xcode runner refusing registration replay before release',
          timeoutMs: 30_000,
        })
      }
      const channelNote = await FS.readJson<{ path: string }>(
        FS.resolvePath('appium-mac2/registration-external-directory.json', root),
      )
      const proof = await CLI.run(FS.resolvePath('appium-mac2/registration-helper', root), {
        args: [
          '--baseline-proof',
          FS.resolvePath('appium-mac2/DerivedData/Build/Products/Debug/WebDriverAgentRunner-Runner.app', root),
        ],
        env: { ...Platform.runtimeProcess.env, TAO_WDA_PROOF_CHANNEL: FS.resolvePath('s', channelNote.path) },
        processPolicy: 'test',
        timeoutMs: 10_000,
      })
      Expect(proof.exitCode).toBe(0)
      signedBaseline = JSON.parse(proof.stdout)
      Expect(signedBaseline).toMatchObject({
        sandbox: true,
        sbplType: 'array',
        sbplCount: phase === 'deny' ? 2 : 3,
        socketMatches: phase === 'deny' ? 0 : 1,
        hidMatches: 1,
        signalMatches: 1,
        xcodeBaseline: true,
        baselineDigest: Platform.sha256Hex(['(allow hid-control)\n(allow signal)\n']),
        acceptedProfile: phase === 'deny' ? 0 : 2,
      })
      await FS.writeJson(FS.resolvePath('signed-baseline-proof.json', root), signedBaseline)
      Expect(backendRequests).toBe(0)
      await desktop?.release()
      desktop = undefined
      await run.cleanup(true)
      const final = await FS.readJson<{ state: string; processes: TrackedProcess[] }>(
        FS.resolvePath('appium-mac2/isolation.json', root),
      )
      Expect(final.state).toBe('closed')
      Expect(
        final.processes.every(value =>
          !ProcessTree.sameProcess(ProcessTree.identities([value.pid]).get(value.pid), value)
        ),
      ).toBe(true)
      Expect((await MachineResources.readOwner({ name: `appium-wda-port-${run.systemPort}` })) === undefined).toBe(true)
      Expect((await MachineResources.readOwner({ name: 'macos-physical-input' })) === undefined).toBe(true)
      const external = await FS.readJson<{ state: string }>(
        FS.resolvePath('appium-mac2/registration-external-directory.json', root),
      )
      Expect(external.state).toBe('removed')
      await FS.writeJson(FS.resolvePath('registration-proof.json', root), {
        phase,
        acknowledged: phase === 'grant',
        signedChannelRule: phase === 'grant',
        signedBaseline,
        replayRejected: phase === 'grant',
        backendRequests,
        inputOperations: 0,
        lifecycle: 'closed',
      })
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await runCleanups(primaryFailure, [
        { label: 'release registration probe desktop', run: () => desktop?.release() },
        { label: 'close registration probe WDA resources', run: () => run.cleanup(true) },
        {
          label: 'record borrowed runner container inventory',
          run: async () => {
            const after = await FS.listDir(containerDirectory)
            await FS.writeJson(FS.resolvePath('container-inventory.json', root), {
              baseline: containerBaseline,
              observedNewPaths: after.filter(value => !containerBaseline.includes(value))
                .map(value => FS.resolvePath(value, containerDirectory)),
              state: 'observed-after-cleanup',
              ownership: 'shared or unknown; preserved, never adopted',
            })
          },
        },
      ], { channel: 'studio-smoke-cleanup', subject: 'WDA registration probe' })
    }
  }
}, 360_000)

for (const fault of ['wrong-generation', 'wrong-capability', 'foreign-bundle']) {
  Test(`refuses native registration from ${fault} before ownership capture or acknowledgement`, async () => {
    const root = await mkTestDir('tao-wda-native-registration-refusal-')
    const fixture = await nativeFixture(root)
    let captured = false
    let registration: Awaited<ReturnType<typeof StudioWdaRegistration.prepare>> | undefined
    let primaryFailure: { error: unknown } | undefined
    try {
      registration = await StudioWdaRegistration.prepare({
        bootstrapRoot: fixture.copied,
        derivedData: fixture.derivedData,
        generation: 'fixture-generation',
        port: 41000,
        root,
        captureHelper: () => {},
        capture: async () => {
          captured = true
        },
      })
      const environment = await nativeEnvironment(fixture.schemePath)
      if (fault === 'wrong-generation') {
        environment['TAO_WDA_GENERATION'] = 'wrong-generation'
      }
      if (fault === 'wrong-capability') {
        environment['TAO_WDA_CAPABILITY'] = 'wrong-capability'
      }
      let bundle = fixture.bundlePath
      if (fault === 'foreign-bundle') {
        bundle = FS.resolvePath('foreign/WebDriverAgentRunner.xctest/Contents/MacOS/WebDriverAgentRunner', root)
        await FS.copyFile(fixture.bundlePath, bundle)
      }
      const result =
        await (await startFixturePeer(fixture, fault === 'foreign-bundle' ? bundle : fixture.peerBinary, environment))
          .waitForClose()
      Expect(result.signal).toBeNull()
      Expect(result.exitCode).toBe(3)
      Expect(captured).toBe(false)
      Expect(registration.acknowledged()).toBe(false)
      const category = fault === 'foreign-bundle' ? 'loaded-bundle' : 'registration-message'
      await until(() => {
        try {
          registration!.assertHealthy()
          return false
        } catch (error) {
          Expect(Errors.formatForLog(error)).toContain(`WDA registration failure category=${category}`)
          return true
        }
      }, {
        description: `native ${fault} guard refusal`,
        // budget-ok: The negative peer has already joined; only delivery of its helper's fixed refusal category remains.
        timeoutMs: 5_000,
      })
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await runCleanups(primaryFailure, [
        { label: 'close refused registration', run: () => registration?.close() },
        { label: 'clean owned signed fixture', run: () => closeFixture(fixture, root) },
      ], { channel: 'studio-smoke-cleanup', subject: 'refused WDA fixture' })
    }
  })
}

async function nativeFixture(root: string) {
  const copied = FS.resolvePath('copied', root)
  const derivedData = FS.resolvePath('DerivedData', root)
  const bundlePath = FS.resolvePath(
    'Build/Products/Debug/WebDriverAgentRunner.xctest/Contents/MacOS/WebDriverAgentRunner',
    derivedData,
  )
  const nativeSource = Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src/StudioWdaRegistration.c')
  const peerSource = FS.resolvePath('peer.c', root)
  const peerBinary = bundlePath
  const invocation = Platform.randomUUID()
  // These negative peers have no sandbox entitlements, never request a macOS container, and fail before signed-host trust.
  const containerPath = FS.resolvePath('peer-lifecycle', root)
  const externalNote = Repo.resolvePath(`.artifacts/tests/studio-smoke/wda-fixture-ownership/${invocation}.json`)
  const ownership = await StudioWdaRegistration.fixtureOwnership({
    containerPath,
    notePath: externalNote,
    details: { invocation, bundlePath, sandboxEntitlements: false },
  })
  await FS.writeText(
    FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.m', copied),
    '  FBWebServer *webServer = [[FBWebServer alloc] init];',
  )
  await FS.writeText(FS.resolvePath('WebDriverAgentMac.xcodeproj/project.pbxproj', copied), 'pinned project')
  const entitlementsPath = FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.entitlements', copied)
  await FS.writeText(entitlementsPath, '<plist><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>')
  const schemePath = FS.resolvePath(
    'WebDriverAgentMac.xcodeproj/xcshareddata/xcschemes/WebDriverAgentRunner.xcscheme',
    copied,
  )
  await FS.writeText(
    schemePath,
    '<TestAction><EnvironmentVariables>'
      + '<EnvironmentVariable key = "USE_PORT" value = "${USE_PORT}" isEnabled = "YES"/>'
      + '<EnvironmentVariable key = "USE_HOST" value = "${USE_HOST}" isEnabled = "YES"/>'
      + '</EnvironmentVariables></TestAction>',
  )
  await FS.mkdir(FS.dirname(bundlePath))
  await FS.writeText(
    peerSource,
    `#define TAO_WDA_RUNNER\n#include "${nativeSource}"\nint main(void) { return tao_wda_register() ? 0 : 3; }`,
  )
  await CLI.mustRun('/usr/bin/clang', {
    args: [peerSource, '-o', peerBinary],
  })

  return {
    copied,
    derivedData,
    bundlePath,
    schemePath,
    peerBinary,
    entitlementsPath,
    externalNote,
    containerPath,
    ownership,
  }
}

async function startFixturePeer(
  fixture: Awaited<ReturnType<typeof nativeFixture>>,
  executable: string,
  environment: Record<string, string>,
) {
  const peer = CLI.start(executable, {
    env: { ...Platform.runtimeProcess.env, ...environment },
    stdio: 'pipe',
    processPolicy: 'test',
    timeoutMs: 10_000,
  })
  await fixture.ownership.captureStarted(peer)
  return peer
}

async function closeFixture(fixture: Awaited<ReturnType<typeof nativeFixture>>, root: string) {
  await fixture.ownership.close()
  await FS.remove(root)
}

async function nativeEnvironment(schemePath: string) {
  const scheme = await FS.readText(schemePath)
  return Object.fromEntries(
    [...scheme.matchAll(/key\s*=\s*"(TAO_WDA_[A-Z]+|USE_PORT|USE_HOST)"\s+value\s*=\s*"([^"]+)"/g)]
      .map(match => [match[1]!, match[2]!]),
  )
}
