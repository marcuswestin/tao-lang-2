import { CLI, Errors, FS, HCI, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'

type WdaPeer = {
  identity: TrackedProcess
  bundlePath: string
  bundleDigest: string
  signedChannelRule: true
  signedXcodeBaseline: boolean
  signedBaselineDigest: string
}
type RegistrationOptions = {
  bootstrapRoot: string
  derivedData: string
  root: string
  generation: string
  port: number
  capture: (peer: WdaPeer) => Promise<void>
  captureHelper: (identity: TrackedProcess) => void
  // Source fixtures replace helper launch only. Every identity and peer attestation still uses kernel inspection.
  startHelper?: typeof CLI.start
  registrationOnly?: 'deny' | 'grant'
  sourceLookupProbe?: true
}
type WdaRegistration = {
  acknowledged: () => boolean
  assertHealthy: () => void
  disable: () => Promise<void>
  close: () => Promise<void>
  redact: (text: string) => string
  sourceDigest: string
  bootstrapDigest: string
  sourceLookupProvenance?: Readonly<{ originalDigest: string; patchedDigest: string }>
  runnerEnvironment: Record<string, string>
}

function runnerConfiguration(scheme: string, environment: Record<string, string>) {
  const actions = [...scheme.matchAll(/<TestAction\b[\s\S]*?<\/TestAction>/g)]
  if (actions.length !== 1) {
    return Errors.throwHostEnvironment('The pinned WDA scheme must have exactly one TestAction.')
  }
  const action = actions[0]![0]
  const blocks = [...action.matchAll(/<EnvironmentVariables>[\s\S]*?<\/EnvironmentVariables>/g)]
  if (
    blocks.length !== 1
    || ['USE_PORT', 'USE_HOST'].some(key =>
      !new RegExp(`<EnvironmentVariable\\s[^>]*key\\s*=\\s*"${key}"[^>]*isEnabled\\s*=\\s*"YES"`).test(blocks[0]![0])
    )
  ) {
    return Errors.throwHostEnvironment('The pinned WDA TestAction is missing enabled port or host environment fields.')
  }
  const escape = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  let retained = blocks[0]![0]
  for (const key of Object.keys(environment)) {
    retained = retained.replace(
      new RegExp(`<EnvironmentVariable\\s[^>]*key\\s*=\\s*"${key}"[^>]*(?:/>|>\\s*</EnvironmentVariable>)`, 'g'),
      '',
    )
  }
  const variables = Object.entries(environment).map(([key, value]) =>
    `         <EnvironmentVariable key="${key}" value="${escape(value)}" isEnabled="YES"/>`
  ).join('\n')
  let patched = action.replace(
    blocks[0]![0],
    retained.replace('<EnvironmentVariables>', `<EnvironmentVariables>\n${variables}`),
  )
  patched = /shouldUseLaunchSchemeArgsEnv\s*=/.test(patched)
    ? patched.replace(/shouldUseLaunchSchemeArgsEnv\s*=\s*"[^"]*"/, 'shouldUseLaunchSchemeArgsEnv="NO"')
    : patched.replace('<TestAction', '<TestAction shouldUseLaunchSchemeArgsEnv="NO"')
  return {
    scheme: scheme.replace(action, patched),
    // Scheme EnvironmentVariables target the test host. Xcode's documented prefix explicitly targets the runner.
    runnerEnvironment: Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [`TEST_RUNNER_${key}`, value]),
    ),
  }
}

function channelRule(channel: string): string {
  if (!/^\/private\/tmp\/tao-wda-[A-Za-z0-9]+\/s$/.test(channel)) {
    return Errors.throwHostEnvironment('The WDA exception requires a canonical invocation-private socket path.')
  }
  return `(allow network-outbound (literal ${JSON.stringify(channel)}))`
}

function runnerEntitlements(original: string, channel: string): string {
  const rule = channelRule(channel)
  if (
    (original.match(/<dict>/g) ?? []).length !== 1 || (original.match(/<\/dict>/g) ?? []).length !== 1
    || !/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/.test(original)
    || original.includes('<key>com.apple.security.temporary-exception.sbpl</key>')
  ) {
    return Errors.throwHostEnvironment(
      'The pinned WDA runner entitlements no longer match the reviewed sandbox bootstrap.',
    )
  }
  return original.replace(
    '</dict>',
    `<key>com.apple.security.temporary-exception.sbpl</key>\n<array><string>${rule}</string></array>\n</dict>`,
  )
}

/** Private copied-runner bootstrap and OS-authenticated pre-bind registration, macOS only. */
function sourceLookupXPath(source: string): string {
  const header = '+ (NSArray *)collectMatchingElementsWithNodes:'
  const start = source.indexOf(header)
  const end = source.indexOf('+ (NSXMLDocument *)xmlRepresentationWithSnapshot:', start)
  const empty = '  if (0 == nodes.count) {\n    return @[];\n  }'
  const resolution = '  return [AMSnapshotUtils elementsWithHashes:hashes.copy\n'
    + '                                 rootElement:rootElement\n'
    + '                                rootSnapshot:rootSnapshot\n'
    + '                       includeOnlyFirstMatch:firstMatch];'
  const body = source.slice(start, end)
  if (
    source.split(header).length !== 2 || end <= start || body.split(empty).length !== 2
    || body.split(resolution).length !== 2
  ) {
    return Errors.throwHostEnvironment(
      'The pinned WDA XPath resolution no longer exposes the reviewed diagnostic anchors.',
    )
  }
  const patched = body.replace(
    empty,
    '  if (0 == nodes.count) {\n    fprintf(stderr, "WDA source lookup counts xml=0 hashes=0 resolved=0\\n");\n    return @[];\n  }',
  ).replace(
    resolution,
    resolution.replace('return [AMSnapshotUtils', 'NSArray *resolved = [AMSnapshotUtils')
      + '\n  NSUInteger nonemptyHashCount = 0;\n'
      + '  for (NSString *hash in hashes) { if (hash.length > 0) nonemptyHashCount++; }\n'
      + '  fprintf(stderr, "WDA source lookup counts xml=%lu hashes=%lu resolved=%lu\\n", '
      + '(unsigned long)nodes.count, (unsigned long)nonemptyHashCount, (unsigned long)resolved.count);\n'
      + '  return resolved;',
  )
  return '#include <stdio.h>\n' + source.slice(0, start) + patched + source.slice(end)
}

async function prepare(options: RegistrationOptions): Promise<WdaRegistration> {
  if (Platform.hostPlatform !== 'darwin') {
    return Errors.throwHostEnvironment('WDA launch registration requires macOS peer credentials and libproc.')
  }
  const runnerPath = FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.m', options.bootstrapRoot)
  const schemePath = FS.resolvePath(
    'WebDriverAgentMac.xcodeproj/xcshareddata/xcschemes/WebDriverAgentRunner.xcscheme',
    options.bootstrapRoot,
  )
  const nativeSource = await FS.readText(Repo.resolvePath(
    'packages/ides/studio-tooling/studio-tooling-src/StudioWdaRegistration.c',
  ))
  const runner = await FS.readText(runnerPath)
  const scheme = await FS.readText(schemePath)
  const entitlementsPath = FS.resolvePath(
    'WebDriverAgentRunner/WebDriverAgentRunner.entitlements',
    options.bootstrapRoot,
  )
  const originalEntitlements = await FS.readText(entitlementsPath)
  const xpathPath = FS.resolvePath('WebDriverAgentLib/Utilities/FBXPath.m', options.bootstrapRoot)
  const originalXPath = options.sourceLookupProbe === true ? await FS.readText(xpathPath) : undefined
  const patchedXPath = originalXPath === undefined ? undefined : sourceLookupXPath(originalXPath)
  const sourceLookupProvenance = originalXPath === undefined || patchedXPath === undefined ? undefined : {
    originalDigest: Platform.sha256Hex([originalXPath]),
    patchedDigest: Platform.sha256Hex([patchedXPath]),
  }
  const marker = '  FBWebServer *webServer = [[FBWebServer alloc] init];'
  if (runner.split(marker).length !== 2 || !scheme.includes('<EnvironmentVariables>')) {
    return Errors.throwHostEnvironment('The pinned WDA runner no longer exposes the reviewed pre-bind bootstrap.')
  }
  const sourceDigest = Platform.sha256Hex([
    runner,
    scheme,
    originalEntitlements,
    nativeSource,
    await FS.readFile(
      FS.resolvePath('WebDriverAgentMac.xcodeproj/project.pbxproj', options.bootstrapRoot),
    ),
    ...(originalXPath === undefined ? [] : [originalXPath]),
  ])
  // Darwin sun_path is 104 bytes. Keep only this short, private transport outside the invocation.
  const externalRoot = await FS.mkTmpDir('/private/tmp/tao-wda-')
  await FS.chmod(externalRoot, 0o700)
  const externalNote = FS.resolvePath('registration-external-directory.json', options.root)
  await FS.writeJson(externalNote, {
    cleanupCondition: 'registration helper and owned WDA shutdown proved',
    owner: 'this WDA invocation',
    path: externalRoot,
    state: 'owned',
  })
  const channel = FS.resolvePath('s', await FS.realPath(externalRoot))
  channelRule(channel)
  const capabilityPath = FS.resolvePath('capability', externalRoot)
  const acknowledgement = FS.resolvePath('acknowledgement', externalRoot)
  const capability = `${Platform.randomUUID()}${Platform.randomUUID()}`
  await FS.writeText(capabilityPath, `${capability}\n`, { mode: 0o600 })
  const helperSource = FS.resolvePath('TaoWdaRegistration.h', options.bootstrapRoot)
  const helperBinary = FS.resolvePath('registration-helper', options.root)
  let helper: ReturnType<typeof CLI.start> | undefined
  let helperIdentity: TrackedProcess | undefined
  let failure: unknown
  let ready = false
  let acknowledged = false
  let pending = ''
  let helperDiagnostics = ''
  let bootstrapDigest = ''
  let runnerEnvironment: Record<string, string> = {}
  let peerSeen = false
  let peerRecorded = false
  let closing = false
  let disabled = false
  let outputWork = Promise.resolve()
  function assertHealthy(): void {
    if (failure !== undefined) {
      throw failure
    }
    if (helper?.error !== undefined && !acknowledged) {
      Errors.throwHostEnvironment('The WDA registration helper failed before acknowledgement (process error).')
    }
    if (helper !== undefined && (helper.exitCode !== null || helper.signalCode !== null) && !acknowledged) {
      const terminal = helper.signalCode !== null ? `signal ${helper.signalCode}` : `exit ${helper.exitCode}`
      Errors.throwHostEnvironment(
        `The WDA registration helper exited before acknowledgement (${terminal}): ${helperDiagnostics.trim()}`,
      )
    }
  }
  async function accept(line: string): Promise<void> {
    if (closing) {
      return
    }
    if (line === 'READY' && !ready) {
      ready = true
      return
    }
    if (line === 'ACKED' && peerRecorded && !acknowledged) {
      acknowledged = true
      return
    }
    const parts = line.split('\t')
    if (
      parts.length !== 8 || parts[0] !== 'PEER' || parts[5] !== '1' || !['1', '2'].includes(parts[6]!) || peerSeen
      || !ready
    ) {
      return Errors.throwHostEnvironment('The WDA registration helper returned an invalid or replayed event.')
    }
    peerSeen = true
    const pid = Number(parts[1])
    const startedAt = parts[2]!
    const bundleDigest = parts[3]!
    const bundlePath = parts[4]!
    const signedXcodeBaseline = parts[6] === '2'
    const signedBaselineDigest = parts[7]!
    const expectedBaseline = Platform.sha256Hex([signedXcodeBaseline ? '(allow hid-control)\n(allow signal)\n' : ''])
    if (
      !Number.isSafeInteger(pid) || pid <= 1 || !/^\d+:\d+$/.test(startedAt)
      || !/^[a-f0-9]{64}$/.test(bundleDigest)
      || signedBaselineDigest !== expectedBaseline
      || !FS.pathIsWithin(bundlePath, FS.resolvePath('Build/Products', options.derivedData))
      || !bundlePath.endsWith('/WebDriverAgentRunner.xctest/Contents/MacOS/WebDriverAgentRunner')
      || await FS.realPath(bundlePath) !== bundlePath
      || Platform.sha256Hex(await FS.readFile(bundlePath)) !== bundleDigest
    ) {
      return Errors.throwHostEnvironment("WDA registration does not match this invocation's built runner.")
    }
    const identity: TrackedProcess = { command: 'registered WDA runner', pid, startedAt }
    if (!ProcessTree.sameProcess(ProcessTree.identities([pid]).get(pid), identity)) {
      return Errors.throwHostEnvironment('WDA registration kernel identity changed before capture.')
    }
    // The caller rechecks desktop generation/listener, persists ownership, then we acknowledge.
    await options.capture({
      identity,
      bundlePath,
      bundleDigest,
      signedChannelRule: true,
      signedXcodeBaseline,
      signedBaselineDigest,
    })
    if (closing) {
      return
    }
    if (!ProcessTree.sameProcess(ProcessTree.identities([pid]).get(pid), identity)) {
      return Errors.throwHostEnvironment('WDA registration kernel identity changed before acknowledgement.')
    }
    peerRecorded = true
    await FS.writeText(acknowledgement, `${pid}\t${startedAt}\n`, { mode: 0o600 })
  }
  async function disable(): Promise<void> {
    closing = true
    if (disabled) {
      return
    }
    if (helper !== undefined && helperIdentity === undefined) {
      return Errors.throwHostEnvironment('WDA registration helper shutdown is unproved without captured identity.')
    }
    if (helperIdentity !== undefined) {
      ProcessTree.signalTracked([helperIdentity], 'SIGTERM')
      const deadline = Time.nowMs() + 5_000
      while (
        ProcessTree.sameProcess(ProcessTree.identities([helperIdentity.pid]).get(helperIdentity.pid), helperIdentity)
      ) {
        if (Time.nowMs() >= deadline) {
          return Errors.throwHostEnvironment('WDA registration helper shutdown is unproved.')
        }
        await Time.sleep(25)
      }
      await helper!.closeOutput()
      helper!.dispose()
    }
    let drained = false
    void outputWork.finally(() => {
      drained = true
    })
    const deadline = Time.nowMs() + 5_000
    while (!drained) {
      if (Time.nowMs() >= deadline) {
        return Errors.throwHostEnvironment('WDA registration capture did not settle during shutdown.')
      }
      await Time.sleep(25)
    }
    disabled = true
  }
  async function close(): Promise<void> {
    await disable()
    await FS.remove(externalRoot)
    await FS.writeJson(externalNote, { owner: 'this WDA invocation', path: externalRoot, state: 'removed' })
  }
  try {
    if (patchedXPath !== undefined) {
      await FS.writeText(xpathPath, patchedXPath, { mode: 0o600 })
    }
    await FS.writeText(helperSource, nativeSource, { mode: 0o600 })
    await FS.writeText(
      runnerPath,
      `#import <Foundation/Foundation.h>\n#define TAO_WDA_RUNNER\n#define TAO_WDA_ENV_VALUE(key) [NSProcessInfo.processInfo.environment[@key] UTF8String]\n#include "../TaoWdaRegistration.h"\n${
        runner.replace(
          marker,
          `  if (!tao_wda_register()) { XCTFail(@"WDA launch registration failed before binding."); return; }\n${
            options.registrationOnly === undefined
              ? ''
              : `${
                options.registrationOnly === 'grant'
                  ? '  if (tao_wda_register()) { XCTFail(@"WDA registration-only replay unexpectedly acknowledged."); return; }\n  fprintf(stderr, "WDA registration-only replay refused\\n");\n'
                  : ''
              }  return; // Fixed registration-only engineering probe; never constructs a backend.\n`
          }${marker}`,
        )
      }`,
      { mode: 0o600 },
    )
    const configuration = runnerConfiguration(scheme, {
      TAO_WDA_CHANNEL: channel,
      TAO_WDA_CAPABILITY: capability,
      TAO_WDA_GENERATION: options.generation,
      TAO_WDA_PORT: String(options.port),
      USE_PORT: String(options.port),
      USE_HOST: '127.0.0.1',
    })
    runnerEnvironment = configuration.runnerEnvironment
    await FS.writeText(
      schemePath,
      configuration.scheme,
      { mode: 0o600 },
    )
    if (options.registrationOnly !== 'deny') {
      await FS.writeText(entitlementsPath, runnerEntitlements(originalEntitlements, channel), { mode: 0o600 })
    }
    bootstrapDigest = Platform.sha256Hex([
      await FS.readFile(runnerPath),
      await FS.readFile(schemePath),
      await FS.readFile(entitlementsPath),
      nativeSource,
      ...(originalXPath === undefined || patchedXPath === undefined ? [] : [originalXPath, patchedXPath]),
    ])
    const compiled = await CLI.run('/usr/bin/clang', {
      args: [
        '-x',
        'c',
        '-Werror',
        '-Wno-deprecated-declarations',
        helperSource,
        '-framework',
        'Security',
        '-framework',
        'CoreFoundation',
        '-o',
        helperBinary,
      ],
    })
    if (compiled.error !== undefined || compiled.exitCode !== 0) {
      Errors.throwHostEnvironment('Could not compile the macOS WDA registration helper.', {
        details: { stderr: compiled.stderr },
      })
    }
    helper = (options.startHelper ?? CLI.start)(helperBinary, {
      args: [channel, capabilityPath, options.generation, options.derivedData, acknowledgement],
      onOutput: (stream, chunk) => {
        if (stream !== 'stdout') {
          helperDiagnostics += chunk.toString()
          return
        }
        pending += chunk.toString()
        const lines = pending.split('\n')
        pending = lines.pop()!
        for (const line of lines) {
          outputWork = outputWork.then(async () => await accept(line)).catch(error => {
            failure ??= error
          })
        }
      },
      processPolicy: 'server',
      stdio: 'pipe',
    })
    helperIdentity = helper.pid === undefined ? undefined : ProcessTree.identities([helper.pid]).get(helper.pid)
    if (helperIdentity === undefined) {
      Errors.throwHostEnvironment('WDA registration helper process identity could not be captured.')
    }
    options.captureHelper(helperIdentity)
    const deadline = Time.nowMs() + 10_000
    while (!ready) {
      assertHealthy()
      if (Time.nowMs() >= deadline) {
        Errors.throwHostEnvironment('WDA registration channel did not become ready.')
      }
      await Time.sleep(25)
    }
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      HCI.logProcessError('studio-mac2', `WDA registration rollback is unproved: ${Errors.formatForLog(cleanupError)}`)
    }
    throw error
  }
  return {
    acknowledged: () => acknowledged && !closing,
    assertHealthy,
    sourceDigest,
    bootstrapDigest,
    sourceLookupProvenance,
    runnerEnvironment,
    disable,
    close,
    redact: text =>
      text.replaceAll(capability, '[redacted WDA capability]').replaceAll(channel, '[redacted WDA channel]'),
  }
}

/** Fixed probe fixture lifecycle; injected filesystem/publication operations are source-test seams only. */
async function fixtureOwnership(options: {
  containerPath: string
  notePath: string
  details: Record<string, unknown>
  inspect?: typeof FS.entryMetadata
  publish?: (record: Record<string, unknown>) => Promise<void>
}) {
  const inspect = options.inspect ?? FS.entryMetadata
  const publish = options.publish ?? (async record => await FS.writeJson(options.notePath, record))
  let record: Record<string, unknown> = {
    ...options.details,
    path: options.containerPath,
    owner: 'fixed signed WDA registration fixture',
    cleanupCondition:
      'every bounded child joined, captured kernel identities closed, canonical private container proved',
  }
  const children: { handle: ReturnType<typeof CLI.start>; identity?: TrackedProcess; joined: boolean }[] = []
  async function update(patch: Record<string, unknown>) {
    record = { ...record, ...patch }
    await publish(record)
  }
  async function metadata(path: string) {
    try {
      return await inspect(path)
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return undefined
      }
      throw error
    }
  }
  async function retain(state: string) {
    await update({ state, safeNextAction: 'owner-reviewed inspection after child closure; preserve unknown resources' })
  }
  let baseline: Awaited<ReturnType<typeof metadata>>
  try {
    baseline = await metadata(options.containerPath)
  } catch (error) {
    await retain('retained-baseline-inspection-unavailable')
    throw error
  }
  if (baseline !== undefined) {
    await retain('retained-baseline-present')
    return Errors.throwHostEnvironment('The unique native fixture container already exists.')
  }
  await update({ containerAbsent: true, state: 'planned-before-launch' })
  async function captureStarted(handle: ReturnType<typeof CLI.start>) {
    // Retain the handle before kernel inspection or any publication can throw.
    const child: typeof children[number] = { handle, joined: false }
    children.push(child)
    const identity = handle.pid === undefined ? undefined : ProcessTree.identities([handle.pid]).get(handle.pid)
    if (identity === undefined) {
      await retain('retained-peer-identity-unavailable')
      return Errors.throwHostEnvironment('The signed fixture kernel identity was unavailable after launch.')
    }
    child.identity = { ...identity, command: 'signed WDA registration fixture' }
    await update({
      peers: children.flatMap(value => value.identity === undefined ? [] : [value.identity]),
      state: 'peer-started',
    })
  }
  async function close() {
    const failures: unknown[] = []
    for (const child of children) {
      try {
        if (child.identity !== undefined) {
          ProcessTree.signalTracked([child.identity], 'SIGTERM')
        }
      } catch (error) {
        failures.push(error)
      }
      try {
        // Fixed callers supply a supervised finite peer. Unknown identities await that close without broad signalling.
        await child.handle.waitForClose()
        child.joined = true
        child.handle.dispose()
        if (child.identity === undefined) {
          Errors.throwHostEnvironment('fixture identity was unavailable')
        }
        const current = ProcessTree.identities([child.identity.pid]).get(child.identity.pid)
        if (ProcessTree.sameProcess(current, child.identity)) {
          Errors.throwHostEnvironment('fixture kernel identity survived close')
        }
      } catch (error) {
        failures.push(error)
      }
    }
    await update({ peersJoined: children.every(value => value.joined), state: 'peers-drained' })
    if (failures.length !== 0) {
      await retain('retained-peer-closure-unproved')
      return Errors.throwHostEnvironment('The signed fixture container was retained because peer closure was unproved.')
    }
    await update({ peersJoined: children.every(value => value.joined), peersClosed: true, state: 'peers-closed' })
    let root: Awaited<ReturnType<typeof metadata>>
    let symlinks = 0
    try {
      root = await metadata(options.containerPath)
      if (root !== undefined) {
        if (root.kind !== 'directory' || await FS.realPath(options.containerPath) !== options.containerPath) {
          Errors.throwHostEnvironment('fixture root is not a canonical directory')
        }
        let entries = 0
        for await (const path of FS.walk(options.containerPath, { includeDirectories: true, includeHidden: true })) {
          const entry = await metadata(path)
          if (
            ++entries > 2048 || entry === undefined || entry.device !== root.device
            || !FS.pathIsWithin(path, options.containerPath)
          ) {
            Errors.throwHostEnvironment('fixture containment is unavailable')
          }
          // walk and remove do not follow links; their targets stay outside this cleanup.
          if (entry.kind === 'symlink') {
            symlinks++
          }
        }
        await FS.remove(options.containerPath)
      }
    } catch (error) {
      await retain('retained-container-inspection-unavailable')
      throw error
    }
    await update({
      created: root !== undefined,
      symlinksUnlinked: symlinks,
      state: 'removed-or-not-created',
      safeNextAction: undefined,
    })
  }
  return { update, captureStarted, close }
}

export const StudioWdaRegistration = {
  prepare,
  runnerConfiguration,
  runnerEntitlements,
  channelRule,
  fixtureOwnership,
  sourceLookupXPath,
} as const
