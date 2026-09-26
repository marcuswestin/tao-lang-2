import { Assert, FS, ProcessTree, Time, type TrackedProcess } from '@shared'

/** Own only the fresh profile for this proof, retaining it if any acceptance or shutdown step fails. */
export async function withDesktopAgentProofProfile(
  options: { appId: string; proofId: string; webKitRoot?: string },
  work: (profile: { path: string; track: (pids: number[]) => void }) => Promise<void>,
): Promise<string> {
  const { appId, proofId } = options
  Assert(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(proofId),
    'the profile belongs to a uniquely named acceptance run',
  )
  const prefix = `dev.tao.local.agentcommandsproof${proofId.replaceAll('-', '')}.`
  Assert(
    appId.startsWith(prefix) && /^[a-f0-9]{8}$/.test(appId.slice(prefix.length)),
    'the profile identity matches this acceptance run',
    { appId, proofId },
  )
  const root = options.webKitRoot ?? FS.resolvePath('Library/WebKit', FS.homeDir())
  const path = FS.resolvePath(appId, root)
  Assert(
    !await FS.exists(path) && !await FS.isSymbolicLink(path),
    'the acceptance profile does not predate this run',
    { path },
  )
  const tracked: TrackedProcess[] = []
  await work({
    path,
    track(pids) {
      Assert(pids.length > 0 && pids.every(pid => Number.isSafeInteger(pid) && pid > 1), 'valid proof process IDs')
      const identities = ProcessTree.identities(pids)
      Assert(pids.every(pid => identities.has(pid)), 'proof process identities are captured before shutdown')
      tracked.push(...identities.values())
      for (const pid of pids) {
        tracked.push(...ProcessTree.descendants(pid))
      }
    },
  })
  Assert(tracked.length > 0, 'the acceptance run tracked its app processes before cleanup')
  const stopped = await Time.pollUntil(() => {
    const current = ProcessTree.identities(tracked.map(process => process.pid))
    return tracked.every(process => !ProcessTree.sameProcess(current.get(process.pid), process))
  }, { timeoutMs: 30_000, intervalMs: 100 })
  Assert(stopped, 'all proof app processes exited before profile cleanup', { path, tracked })
  Assert(!await FS.isSymbolicLink(path), 'the proof profile was not replaced by a symbolic link', { path })
  if (await FS.exists(path)) {
    Assert(
      await FS.realPath(path) === FS.resolvePath(appId, await FS.realPath(root)),
      'the proof profile remains inside its WebKit directory',
      { path },
    )
    await FS.remove(path)
  }
  Assert(!await FS.exists(path), 'the successful proof removed its WebKit profile', { path })
  return path
}
