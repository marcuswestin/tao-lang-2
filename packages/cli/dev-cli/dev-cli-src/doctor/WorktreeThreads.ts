import { CLI, Errors, Repo } from '@shared'

/** A local task record whose working directory exactly matches a Git worktree. */
export type WorktreeThread = {
  app: 'claude' | 'codex' | 'cursor'
  archived: boolean
  createdAt: string | null
  description: string
  id: string
  label?: string | null
  lastActivity?: string | null
  lastActivityAt: string | null
  path: string
  title: string
}

export type WorktreeThreadInventory = {
  byPath: Record<string, WorktreeThread[]>
  providers: Record<WorktreeThread['app'], string>
}

/** readWorktreeThreads asks the standard-library-only inventory script for exact-path task links. */
export async function readWorktreeThreads(paths: readonly string[]): Promise<WorktreeThreadInventory> {
  const result = await CLI.run('python3', {
    args: [Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/doctor/worktree_thread_inventory.py')],
    stdin: JSON.stringify({ paths }),
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Could not read agent task indexes: ${result.stderr || result.error?.message || result.exitCode}`,
    )
  }
  let inventory: WorktreeThreadInventory
  try {
    inventory = JSON.parse(result.stdout) as WorktreeThreadInventory
  } catch (error) {
    Errors.throwHostEnvironment('Agent task inventory returned invalid JSON.', { cause: error })
  }
  if (
    !inventory.providers || !inventory.byPath || !['codex', 'claude', 'cursor'].every(app => app in inventory.providers)
  ) {
    Errors.throwHostEnvironment('Agent task inventory omitted a provider; refusing to infer absent tasks.')
  }
  return inventory
}

/** An unavailable installed index is not evidence that its tasks are absent. */
export function threadInventoryAvailable(inventory: WorktreeThreadInventory): boolean {
  return Object.values(inventory.providers).every(status => status === 'ok' || status === 'not-installed')
}
