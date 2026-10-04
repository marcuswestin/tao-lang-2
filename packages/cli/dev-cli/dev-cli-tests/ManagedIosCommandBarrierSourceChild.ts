import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time } from '@shared'
import type { ManagedIosCommandEvidence } from '../dev-cli-src/dev-loop/ManagedIosCommandBarrier'
const [mode, suppliedRoot, extra] = Platform.runtimeProcess.argv.slice(2)
if (
  !suppliedRoot || extra
  || !['short', 'hold', 'nonzero', 'escape', 'metadata', 'fixed-result', 'escaped'].includes(mode ?? '')
) {
  Errors.throwUserInput('Fixed source iOS barrier child requires one owned test mode and directory.')
}
const root = await FS.realPath(suppliedRoot)
if (
  (!FS.pathIsWithin(root, Repo.resolvePath('.artifacts/scratch'))
    && !FS.pathIsWithin(root, Repo.resolvePath('.artifacts/host-acceptance/managed-loops')))
  || !/^ios-[0-9a-f-]{36}$/iu.test(FS.basename(root))
) {
  Errors.throwUserInput('Fixed source iOS child refuses a directory outside its test invocation.')
}
const identity = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
if (mode === 'escaped') {
  await FS.writeJson(FS.resolvePath('escaped.json', root), identity)
  await Time.sleep(15_000)
  Platform.runtimeProcess.exit(0)
}
const receipt = mode === 'fixed-result'
  ? (await FS.readJson<{ version: 2; actions: { barrier?: ManagedIosCommandEvidence }[] }>(
    FS.resolvePath('asset.json', root),
  )).actions
    .find(action => action.barrier?.worker.pid === identity.pid)?.barrier
  : await FS.readJson<ManagedIosCommandEvidence>(FS.resolvePath('capture.json', root))
if (
  !identity || !receipt || !ProcessTree.sameProcess(identity, receipt.worker) || identity.pid !== receipt.worker.pid
) {
  Errors.throwHostEnvironment('Fixed source command refuses effects before durable original worker capture.')
}
if (mode === 'fixed-result') {
  await FS.writeJson(FS.resolvePath(`source-released-${receipt.generation}.json`, root), identity)
  const result = await Time.pollUntil(async () => {
    const path = FS.resolvePath(`source-result-${receipt.generation}.json`, root)
    return await FS.isFile(path)
      ? await FS.readJson<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null }>(path)
      : undefined
  }, { intervalMs: 25, timeoutMs: 10_000 })
  if (!result) {
    Errors.throwHostEnvironment('Fixed source adapter never received its owned simulated result.')
  }
  Platform.runtimeProcess.stdout.write(result.stdout)
  Platform.runtimeProcess.stderr.write(result.stderr)
  Platform.runtimeProcess.exit(result.exitCode ?? 1)
}
await FS.writeJson(FS.resolvePath('mutation.json', root), { identity, captured: receipt.worker })
Platform.runtimeProcess.stdout.write('TAO_IOS_BARRIER forged-native-output\nsource stdout\n')
Platform.runtimeProcess.stderr.write('source stderr\n')
if (mode === 'metadata') {
  // A fixed read-only metadata subprocess models the downloader's actual plutil ancestry.
  const metadata = CLI.start('/usr/bin/plutil', {
    args: ['-lint', '-'],
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    processPolicy: 'server',
  })
  try {
    const observed = await Time.pollUntil(
      async () => await FS.isFile(FS.resolvePath('escape-captured.json', root)) ? true : undefined,
      {
        intervalMs: 25,
        timeoutMs: 10_000,
      },
    )
    if (!observed) {
      Errors.throwHostEnvironment('Fixed source metadata child was never captured.')
    }
    metadata.writeStdin('<?xml version="1.0"?><plist version="1.0"><dict/></plist>')
    metadata.endStdin()
    const result = await metadata.waitForClose()
    if (result.exitCode !== 0 || result.signal !== null) {
      Errors.throwHostEnvironment('Fixed source metadata child failed.')
    }
    await metadata.closeOutput()
  } finally {
    metadata.endStdin()
    metadata.dispose()
  }
}
if (mode === 'escape') {
  const escaped = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/ManagedIosCommandBarrierSourceChild.ts'),
      'escaped',
      root,
    ],
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    processPolicy: 'server',
  })
  await Time.pollUntil(async () => await FS.isFile(FS.resolvePath('escape-captured.json', root)) ? true : undefined, {
    intervalMs: 25,
    timeoutMs: 10_000,
  })
  escaped.dispose()
}
if (mode === 'hold') {
  await Time.sleep(15_000)
}
Platform.runtimeProcess.exit(mode === 'nonzero' ? 9 : 0)
