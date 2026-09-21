import Runtime from '@expo-host'
import { CLI, Errors, FS, Platform, Repo } from '@shared'

type HostSubject = 'clockwork' | 'hnreader'
export type HostApplicationFault = 'clockwork-countdown-frozen' | 'hnreader-reading-history-no-write'
export type HostFaultProvenance = Readonly<{
  expectedVisibleAssertion: string
  kind: HostApplicationFault
  originalDigest: string
  replacementDigest: string
  targetPath: string
}>
export type HostBuild = {
  appId: string
  compiledArtifactDigest: string
  entrySourceDigest: string
  fault?: HostFaultProvenance
  root: string
}
export type PrepareHostAppOptions = {
  artifactRoot: string
  fault?: HostApplicationFault
  runId: string
  seed: number
  subject: HostSubject
}
type HostCommandReceipt = {
  error?: string
  exitCode: number | null
  signal: string | null
  stderr: string
  stdout: string
}
export type HostWebExport = { receipt: HostCommandReceipt; root: string }

const HOST_EPOCH_MS = Date.UTC(2026, 0, 1, 9, 0, 0)

/** prepareHostApp builds one production-shaped Expo project in an isolated artifact directory. */
export async function prepareHostApp(options: PrepareHostAppOptions): Promise<HostBuild> {
  assertIdentifier(options.runId, 'run id')
  assertSeed(options.seed)
  const subject = subjectSource(options.subject)
  const repositoryRoot = Repo.getRoot()
  const root = FS.resolvePath(`host-${options.subject}-${options.runId}`, options.artifactRoot)
  const runtimeToolchainRoot = FS.resolvePath('packages/apps/expo-host', repositoryRoot)
  await FS.remove(root)
  await FS.mkdir(root)
  await copyProductionHostFiles(runtimeToolchainRoot, root)
  await FS.symlink(FS.resolvePath('node_modules', runtimeToolchainRoot), FS.resolvePath('node_modules', root))
  const sourcePath = FS.resolvePath(subject.sourcePath, repositoryRoot)
  const entrySourceDigest = Platform.sha256Hex(await FS.readText(sourcePath))
  const appId = `dev.tao.taohost${options.subject}${options.runId.replaceAll('-', '')}`
  await Runtime.generateApp(sourcePath, { appName: subject.appName, runtimePackageRoot: root })
  const fault = options.fault === undefined
    ? undefined
    : await applyApplicationFault(root, options.subject, options.fault)
  const compiledArtifactDigest = await generatedArtifactDigest(FS.resolvePath('_gen_tao-app', root))
  await FS.writeJson(FS.resolvePath('HostTestConfig.json', root), {
    epochMs: HOST_EPOCH_MS,
    runId: options.runId,
    seed: options.seed,
    subject: options.subject,
  })
  await FS.writeText(FS.resolvePath('index.ts', root), hostEntrypoint(repositoryRoot))
  await FS.writeText(FS.resolvePath('app.json', root), hostAppConfig(appId, options.runId))
  return { appId, compiledArtifactDigest, entrySourceDigest, ...(fault === undefined ? {} : { fault }), root }
}

/** exportHostWeb exports a prepared isolated host project using Expo's production web pipeline. */
export async function exportHostWeb(build: HostBuild, options: { artifactRoot: string }): Promise<HostWebExport> {
  const root = FS.resolvePath(`web-${build.appId}`, options.artifactRoot)
  if (await FS.exists(root)) {
    Errors.throwUserInput(`Host web export directory already exists: ${root}`)
  }
  const result = await CLI.run(FS.resolvePath('node_modules/.bin/expo', build.root), {
    args: ['export', '--platform', 'web', '--output-dir', root],
    cwd: build.root,
    env: {
      ...Platform.runtimeProcess.env,
      CI: '1',
      EXPO_NO_DOTENV: '1',
      TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: FS.resolvePath('packages/apps/expo-host', Repo.getRoot()),
    },
    prefixedOutput: { processName: `host-web-${build.appId}` },
    processPolicy: 'test',
    timeoutMs: 120_000,
    idleOutputMs: 30_000,
  })
  return {
    receipt: {
      ...(result.error === undefined ? {} : { error: result.error.message }),
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
    },
    root,
  }
}

function subjectSource(subject: HostSubject): { appName: string; sourcePath: string } {
  return subject === 'hnreader'
    ? { appName: 'HNReaderStub', sourcePath: 'Apps/HNReader/HNReader.tao' }
    : { appName: 'Clockwork', sourcePath: 'packages/testing/e2e-testing/fixtures/Clockwork/Clockwork.tao' }
}

async function applyApplicationFault(
  root: string,
  subject: HostSubject,
  fault: HostApplicationFault,
): Promise<HostFaultProvenance> {
  const mutation = applicationFault(subject, fault)
  const path = FS.resolvePath(mutation.targetPath, root)
  const original = await FS.readText(path)
  const matches = original.split(mutation.expected).length - 1
  if (matches !== 1) {
    return Errors.throwUnexpected(
      `Host application fault '${fault}' expected one generated target in ${mutation.targetPath}, found ${matches}.`,
    )
  }
  const replacement = original.replace(mutation.expected, mutation.replacement)
  await FS.writeText(path, replacement)
  return {
    expectedVisibleAssertion: mutation.expectedVisibleAssertion,
    kind: fault,
    originalDigest: Platform.sha256Hex(original),
    replacementDigest: Platform.sha256Hex(replacement),
    targetPath: mutation.targetPath,
  }
}

function applicationFault(
  subject: HostSubject,
  fault: HostApplicationFault,
): Readonly<{ expected: string; expectedVisibleAssertion: string; replacement: string; targetPath: string }> {
  if (subject === 'clockwork' && fault === 'clockwork-countdown-frozen') {
    return {
      expected: [
        '_Scope.Remaining = TR.Alias(() => TR.Binary(TR.Units.Build(TR.Value(10), 1000000000), "-", ',
        '_Scope.Elapsed.evaluate()))',
      ].join(''),
      expectedVisibleAssertion: 'Countdown: 0:09',
      replacement: '_Scope.Remaining = TR.Alias(() => TR.Units.Build(TR.Value(10), 1000000000))',
      targetPath: '_gen_tao-app/App.tsx',
    }
  }
  if (subject === 'hnreader' && fault === 'hnreader-reading-history-no-write') {
    return {
      expected: '          await storage.setItem(storageKey, snapshot)',
      expectedVisibleAssertion: '2 opened after reload',
      replacement: '          void storage\n          void storageKey\n          void snapshot',
      targetPath: '_gen_tao-app/modules/external/Local.ts',
    }
  }
  return Errors.throwUnexpected(`Host application fault '${fault}' does not apply to '${subject}'.`)
}
async function copyProductionHostFiles(runtimeToolchainRoot: string, root: string): Promise<void> {
  for (const file of ['app-config.cjs', 'metro.config.cjs', 'package.json'] as const) {
    await FS.copyFile(FS.resolvePath(file, runtimeToolchainRoot), FS.resolvePath(file, root))
  }
}
export function hostEntrypoint(repositoryRoot: string): string {
  const nativeControl = FS.resolvePath(
    'packages/runtime/TaoRuntime-src/host-testing/NativeHostTestControl.ts',
    repositoryRoot,
  )
  const runtimeControl = FS.resolvePath(
    'packages/runtime/TaoRuntime-src/host-testing/RuntimeHostTestControl.ts',
    repositoryRoot,
  )
  return `import { registerRootComponent } from 'expo'\nimport { createElement, type ComponentType, useEffect, useState } from 'react'\nimport { Platform, SafeAreaView as View, Text } from 'react-native'\nimport { installNativeHostTestControl } from ${
    JSON.stringify(nativeControl)
  }\nimport { installRuntimeHostTestControl } from ${
    JSON.stringify(runtimeControl)
  }\nimport config from './HostTestConfig.json'\n\nconst environment = installRuntimeHostTestControl(config)\nlet latestNativeControlReceipt: string | undefined\nlet publishNativeControlReceipt: ((receipt: string) => void) | undefined\nconst nativeControl = Platform.OS === 'web'\n  ? undefined\n  : installNativeHostTestControl(environment, {\n    onAdvance(snapshot) {\n      const advanceMs = snapshot.lastControlAdvanceMs\n      if (advanceMs === undefined) {\n        return\n      }\n      latestNativeControlReceipt = \`Control received: advance \${advanceMs}ms\`\n      publishNativeControlReceipt?.(latestNativeControlReceipt)\n    },\n  })\nif (nativeControl !== undefined) {\n  void nativeControl.ready\n}\n\nconst generatedApp = require('./_gen_tao-app/App') as { default: ComponentType }\nconst readiness = \`Host ready: run \${config.runId} · seed \${config.seed}\`\nconst HostApp: ComponentType = () => {\n  const [nativeControlReceipt, setNativeControlReceipt] = useState(latestNativeControlReceipt)\n  useEffect(() => {\n    const publish = (receipt: string): void => setNativeControlReceipt(receipt)\n    publishNativeControlReceipt = publish\n    if (latestNativeControlReceipt !== undefined) {\n      publish(latestNativeControlReceipt)\n    }\n    return () => {\n      if (publishNativeControlReceipt === publish) {\n        publishNativeControlReceipt = undefined\n      }\n    }\n  }, [])\n  if (config.subject !== 'hnreader') {\n    return createElement(generatedApp.default)\n  }\n  return createElement(\n    View,\n    { style: { flex: 1 } },\n    createElement(Text, { accessibilityLabel: readiness, testID: 'tao-host-ready' }, readiness),\n    nativeControlReceipt === undefined\n      ? null\n      : createElement(\n        Text,\n        { accessibilityLabel: nativeControlReceipt, testID: 'tao-host-control-receipt' },\n        nativeControlReceipt,\n      ),\n    createElement(generatedApp.default),\n  )\n}\n\nregisterRootComponent(HostApp)\n`
}
function hostAppConfig(appId: string, runId: string): string {
  return `${
    JSON.stringify(
      {
        expo: {
          android: { package: appId, softwareKeyboardLayoutMode: 'pan' },
          experiments: { autolinkingModuleResolution: true },
          ios: { bundleIdentifier: appId },
          name: appId,
          platforms: ['ios', 'android', 'web'],
          plugins: [
            ['expo-build-properties', { ios: { enableSceneSupport: true } }],
          ],
          scheme: `taohostpoc-${runId}`,
          slug: appId.replaceAll('.', '-'),
          version: '1.0.0',
          web: { bundler: 'metro' },
        },
      },
      null,
      2,
    )
  }\n`
}
async function generatedArtifactDigest(root: string): Promise<string> {
  const identities: string[] = []
  await collectGeneratedIdentities(root, root, identities)
  return Platform.sha256Hex(identities.toSorted().join('\n'))
}
async function collectGeneratedIdentities(root: string, current: string, identities: string[]): Promise<void> {
  for (const name of await FS.listDir(current)) {
    const path = FS.resolvePath(name, current)
    if (await FS.isDirectory(path)) {
      await collectGeneratedIdentities(root, path, identities)
      continue
    }
    const relative = path.slice(root.length + 1)
    identities.push(`${relative}\n${Platform.sha256Hex(await FS.readText(path))}`)
  }
}
function assertIdentifier(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) {
    Errors.throwUserInput(`Host test ${label} must be lowercase letters, digits, and hyphens: ${value}`)
  }
}
function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    Errors.throwUserInput(`Host test seed must be an unsigned 32-bit integer: ${seed}`)
  }
}
