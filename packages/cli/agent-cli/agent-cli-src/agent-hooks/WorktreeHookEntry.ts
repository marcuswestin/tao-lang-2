import { Errors } from '@shared'
import { writeErrorLine, writeLine } from '@shared/HCI'
import { readStdinText, runtimeProcess } from '@shared/Platform'
import { createWorktree, removeWorktree } from './WorktreePlacement'

/**
 * The WorktreeCreate and WorktreeRemove entry the `agent-worktree.zsh` shim runs. Create prints the
 * worktree's path as the last line of stdout, which is how the harness learns where the session
 * works; everything else goes to stderr. A failure exits non-zero, which the harness reads as no
 * worktree made, or none removed.
 */
async function runWorktreeHook(mode: string, payload: Record<string, unknown>): Promise<void> {
  const cwd = typeof payload['cwd'] === 'string' ? payload['cwd'] : runtimeProcess.cwd()
  if (mode === 'create') {
    writeLine(await createWorktree({ cwd, name: String(payload['name'] ?? '') }, { log: writeErrorLine }))
    return
  }
  if (mode === 'remove') {
    await removeWorktree({ cwd, worktreePath: String(payload['worktree_path'] ?? '') })
    return
  }
  Errors.throwUserInput(`Unknown worktree hook mode '${mode}': expected create or remove.`)
}

if (import.meta.main) {
  try {
    const text = await readStdinText()
    await runWorktreeHook(runtimeProcess.argv[2] ?? '', text.trim() === '' ? {} : JSON.parse(text))
  } catch (error) {
    writeErrorLine(Errors.asError(error).message)
    runtimeProcess.setExitCode(1)
  }
}
