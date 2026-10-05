import type { Command } from '@commander-js/extra-typings'
import { Errors, FS, HCI, Platform, Repo, ResourceInventory } from '@shared'

/** One read-only inventory front door for product and repository commands. */
export function registerResourceCommands(commands: Command): void {
  commands.command('resources')
    .description(
      'Inspect owned sessions, retained resources, worktrees, caches, and temporary output; never clean automatically.',
    )
    .option('--json', 'Print the complete inventory as JSON.')
    .option('--task <id>', 'Associate a nonstandard directory with this task.')
    .option('--register-directory <path>', 'Record an additional task directory for later cleanup review.')
    .option('--purpose <text>', 'Why the registered directory exists.')
    .option('--cleanup-condition <text>', 'When the registered directory can be reviewed for cleanup.')
    .action(async (options: {
      json?: boolean
      task?: string
      registerDirectory?: string
      purpose?: string
      cleanupCondition?: string
    }) => {
      const checkout = Repo.tryGetRoot() ?? Platform.runtimeProcess.cwd()
      if (options.registerDirectory !== undefined) {
        if (!options.purpose || !options.cleanupCondition || !options.task) {
          Errors.throwUserInput('Directory registration requires --task, --purpose, and --cleanup-condition.')
        }
        await ResourceInventory.registerDirectory({
          path: FS.resolvePath(options.registerDirectory),
          checkout,
          taskId: options.task,
          purpose: options.purpose,
          cleanupCondition: options.cleanupCondition,
        })
      } else if (options.purpose !== undefined || options.cleanupCondition !== undefined) {
        Errors.throwUserInput('--purpose and --cleanup-condition require --register-directory.')
      }
      const report = await ResourceInventory.inspect({ checkout, mode: 'full', taskId: options.task })
      HCI.writeLine(options.json ? JSON.stringify(report) : ResourceInventory.formatReport(report))
    })
}

/** A failed audit must never turn an already successful landing into a failed landing. */
export async function reportPostLandingResources(
  checkout: string,
  inspect = ResourceInventory.inspect,
): Promise<void> {
  HCI.writeErrorLine('Checking resources after landing…')
  try {
    const report = await inspect({ checkout, mode: 'full' })
    const path = FS.resolvePath('.artifacts/resources/after-land.json', checkout)
    await FS.writeJson(path, report, { mode: 0o600 })
    const counts = [...new Set(report.entries.map(entry => entry.classification))]
      .map(kind => `${kind}: ${report.entries.filter(entry => entry.classification === kind).length}`)
    HCI.writeErrorLine(`Resource review: ${counts.join(', ') || 'no resources found'}. Full inventory: ${path}`)
    for (const warning of report.warnings) {
      HCI.writeErrorLine(`Resource warning: ${warning}`)
    }
    HCI.writeErrorLine(
      'Review this task’s resources with the Developer before cleanup; active sessions may still be wanted.',
    )
  } catch (error) {
    HCI.writeErrorLine(
      `Landing completed; resource inspection failed: ${Errors.formatForUser(error)}. Run tao resources to retry.`,
    )
  }
}
