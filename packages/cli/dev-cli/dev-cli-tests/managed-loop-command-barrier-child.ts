import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'

const [mode, suppliedRoot] = Platform.runtimeProcess.argv.slice(2)
if (!['short', 'escape', 'escaped'].includes(mode ?? '') || !suppliedRoot) {
  Errors.throwUserInput('The source barrier child accepts only its fixed fixture modes and scratch directory.')
}
const root = await FS.realPath(suppliedRoot)
if (
  !FS.pathIsWithin(root, Repo.resolvePath('.artifacts/scratch'))
  || !FS.basename(root).startsWith('managed-command-barrier-')
) {
  Errors.throwUserInput('The source barrier child requires its owned test scratch directory.')
}
const identity = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
if (identity === undefined) {
  Errors.throwHostEnvironment('The fixed source child could not inspect its original kernel.')
}
if (mode === 'escaped') {
  await FS.writeJson(FS.resolvePath('escape-ready.json', root), identity)
  await Time.sleep(15_000)
  Platform.runtimeProcess.exit(0)
}
const receipt = await FS.readJson<{ state: string; worker: TrackedProcess }>(FS.resolvePath('capture.json', root))
if (
  receipt.state !== 'published' || receipt.worker.pid !== identity.pid
  || !ProcessTree.sameProcess(identity, receipt.worker)
) {
  Errors.throwHostEnvironment(
    'The source child refuses mutation without its already-published original kernel capture.',
  )
}
if (mode === 'escape') {
  const escaped = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/managed-loop-command-barrier-child.ts'),
      'escaped',
      root,
    ],
    cwd: Repo.getRoot(),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    processPolicy: 'server',
  })
  // budget-ok: Hold the original worker alive until this controlled escape is visible and independently captured.
  const ready = await Time.pollUntil(
    async () => await FS.isFile(FS.resolvePath('escape-ready.json', root)) ? true : undefined,
    { intervalMs: 25, timeoutMs: 10_000 },
  )
  if (!ready) {
    Errors.throwHostEnvironment('The controlled source escape did not publish readiness.')
  }
  await FS.writeJson(FS.resolvePath('escape-visible.json', root), { pid: escaped.pid })
  // budget-ok: This fixed fixture gate lets the parent record the visible descendant before the original worker exits.
  const captured = await Time.pollUntil(
    async () => await FS.isFile(FS.resolvePath('escape-captured.json', root)) ? true : undefined,
    { intervalMs: 25, timeoutMs: 10_000 },
  )
  if (!captured) {
    Errors.throwHostEnvironment('The controlled source escape was not independently captured.')
  }
  escaped.dispose()
}
await FS.writeJson(FS.resolvePath('mutation.json', root), { identity, publishedState: receipt.state })
Platform.runtimeProcess.exit(0)
