import { findProjectRoot, uninstalledLockedDependencies } from '@project-tooling'
import { FS, HCI } from '@shared'

type InstallOfferOptions = Parameters<typeof HCI.isInteractive>[0] & {
  confirmInstall?: (question: string) => Promise<boolean>
  install?: (projectRoot: string) => Promise<void>
}

/**
 * offerMissingInstalls asks, in an interactive terminal, to run `tao install` for each project
 * under `paths` whose lock pins npm packages that are not installed, before a command compiles it.
 * It never fails the command: declining, or running without a terminal, leaves the compile to
 * report each missing package with the same remedy, and only for the apps the command selects.
 */
export async function offerMissingInstalls(paths: readonly string[], options: InstallOfferOptions = {}): Promise<void> {
  if (!HCI.isInteractive(options)) {
    return
  }
  const roots = new Set<string>()
  for (const path of paths) {
    const root = await findProjectRoot(path)
    if (root !== undefined) {
      roots.add(root)
    }
  }
  for (const root of roots) {
    const missing = await uninstalledLockedDependencies(root)
    if (missing.length === 0) {
      continue
    }
    const question = `${FS.displayPath(root)} pins npm packages that are not installed (${
      missing.join(', ')
    }). Run \`tao install\` now?`
    const approved = options.confirmInstall === undefined
      ? await HCI.askConfirm({ ...options, defaultValue: true, message: question })
      : await options.confirmInstall(question)
    if (!approved) {
      continue
    }
    if (options.install === undefined) {
      const { runTaoInstall } = await import('./install-command')
      await runTaoInstall(root, { output: options.output })
    } else {
      await options.install(root)
    }
  }
}
