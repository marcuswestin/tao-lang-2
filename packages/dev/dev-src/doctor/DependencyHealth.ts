import { CLI, FS, HCI, Platform, Repo } from '@shared'

/*
 * Detects an installed tree whose package directories are all present but whose contents are not.
 * Bun's own verification is shallow: after an install that was denied partway through, `bun install
 * --frozen-lockfile` reported "no changes" for a tree whose `ink` was missing half its build
 * output, so nothing repaired it and the failure surfaced later as an unrelated-looking crash.
 *
 * This is a detector, not an integrity check. It samples the third-party modules the repository's
 * own entry commands load at startup, because a module that only resolves is not evidence: `ink`
 * resolved to a build entry that then failed to load its own siblings. Loading is the cheapest
 * check that sees that, so each probe imports rather than resolves.
 *
 * Every probe names its own directory. Bun links workspace dependencies per package, so `ink` is
 * unresolvable from the repository root even in a perfectly healthy checkout, and the Expo probe
 * additionally runs under the pinned devenv Node because Node resolution is the risk it covers.
 */
type Probe = {
  modules: readonly string[]
  /** Probes under the pinned devenv Node rather than Bun, where Node resolution is the risk. */
  node?: boolean
  packageDir: string
}

type DependencyHealthDependencies = {
  isFile?: (path: string) => Promise<boolean>
  run?: typeof CLI.run
}

const PROBES: readonly Probe[] = [
  // Node resolution for the Expo toolchain, which the runtime package's jest harness needs.
  { modules: ['expo/metro-config', 'jest-expo/jest-preset'], node: true, packageDir: 'packages/apps/expo-host' },
  // What `./dev` loads before it can render a work graph or watch a tree.
  { modules: ['ink', 'react', 'commander', '@commander-js/extra-typings', 'chokidar'], packageDir: 'packages/dev' },
  // What `./tao` loads to build its command surface and completions.
  { modules: ['@bomb.sh/tab'], packageDir: 'packages/cli/tao-cli' },
  // What the parser loads before any Tao source can be read.
  { modules: ['langium'], packageDir: 'packages/language/parser' },
]

/**
 * dependencyHealthError returns the first probe failure, or undefined when the tree loads.
 * The devenv profile is the Expo probe's interpreter, so its absence skips that probe rather than
 * failing it: a checkout without the profile has a different problem, which the doctor names.
 */
export async function dependencyHealthError(
  repositoryRoot = Repo.getRoot(),
  dependencies: DependencyHealthDependencies = {},
): Promise<string | undefined> {
  const node = FS.resolvePath('.devenv/profile/bin/node', repositoryRoot)
  const nodePresent = await (dependencies.isFile ?? FS.isFile)(node)
  for (const probe of PROBES) {
    if (probe.node === true && !nodePresent) {
      continue
    }
    const failure = await probeFailure(probe, repositoryRoot, node, dependencies.run ?? CLI.run)
    if (failure !== undefined) {
      return failure
    }
  }
  return undefined
}

async function probeFailure(
  probe: Probe,
  repositoryRoot: string,
  node: string,
  run: typeof CLI.run,
): Promise<string | undefined> {
  const result = probe.node === true
    ? await run(node, {
      args: ['-e', probe.modules.map(module => `require(${JSON.stringify(module)})`).join('; ')],
      cwd: FS.resolvePath(probe.packageDir, repositoryRoot),
    })
    : await run('bun', {
      args: ['-e', probe.modules.map(module => `await import(${JSON.stringify(module)})`).join('\n')],
      cwd: FS.resolvePath(probe.packageDir, repositoryRoot),
    })
  if (result.error === undefined && result.exitCode === 0) {
    return undefined
  }
  const stderr = result.stderr.trim()
  const detail = result.error?.message
    ?? [...stderr.split('\n')].reverse().find(line => /(?:error|failed|cannot|could not|not found)/iu.test(line))
      ?.trim()
    ?? stderr.split('\n').find(line => line.trim() !== '')?.trim()
    ?? `exit code ${result.exitCode ?? 'unknown'}`
  return `${probe.packageDir}: ${detail}`
}

if (import.meta.main) {
  const failure = await dependencyHealthError()
  if (failure !== undefined) {
    HCI.writeErrorLine(`dependency health: ${failure}`)
  }
  Platform.runtimeProcess.setExitCode(failure === undefined ? 0 : 1)
}
