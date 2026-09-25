import { OutputText } from '@cli-kit'
import { CLI, FS, HCI, Repo } from '@shared'

/**
 * `just clean` and `just clean-all`, as steps a reader can watch rather than one silent block.
 *
 * Removing a checkout's dependencies and generated trees takes minutes, and the recipes said
 * nothing while it happened: a stalled `find` over `node_modules` and a finished clean looked
 * identical. Each step therefore names itself as it starts and states what it cost when it ends.
 *
 * The removals follow the recipes' order and include the checkout-keyed test cache in host temp.
 * This lives in TypeScript rather than the Justfile because timing and reporting each step is more
 * shell than a recipe should carry.
 *
 * Bootstrap scratch is not here. `just clean-scratch` stays its own recipe and already reports
 * what it freed, and both cleaning recipes still run it first as a Just dependency.
 */

/** CleanScope names how much of the checkout a run removes. */
export type CleanScope = 'all' | 'checkout'

/** CleanStep is one named removal: what a reader is told, and the command that does it. */
export type CleanStep = {
  args: readonly string[]
  command: string
  name: string
}

/** RunCleanOptions configures one clean run; the injection points exist for its tests. */
type RunCleanOptions = {
  now?: () => number
  repositoryRoot?: string
  /** Injected so tests observe the reporting without removing anything. */
  runStep?: (step: CleanStep, cwd: string) => Promise<number>
  scope?: CleanScope
}

/**
 * What `clean` removes: build and dev artifacts, the runtime toolchain's Expo and generated app
 * trees, the checkout-keyed temp test cache, and every installed `node_modules`. Keep `find`
 * pruning rather than descending into what it is about to delete.
 */
const CHECKOUT_STEPS: readonly CleanStep[] = [
  {
    args: [
      '-rf',
      '.artifacts/build',
      '.artifacts/dev',
      'packages/apps/expo-host/.expo',
      'packages/apps/expo-host/_gen_tao-app',
      'packages/apps/expo-host/_gen_tao-app-test',
    ],
    command: 'rm',
    name: 'Removing build and dev artifacts',
  },
  {
    args: ['.', '-name', 'node_modules', '-type', 'd', '-prune', '-exec', 'rm', '-rf', '{}', '+'],
    command: 'find',
    name: 'Removing installed node_modules trees',
  },
]

/** What `clean-all` removes on top of `clean`: the whole artifact root and the native projects. */
const ALL_STEPS: readonly CleanStep[] = [
  {
    args: ['-rf', '.artifacts', 'packages/apps/expo-host/ios', 'packages/apps/expo-host/android'],
    command: 'rm',
    name: 'Removing every remaining artifact and native project',
  },
]

/** stepsFor names the removals one scope performs, in the order the recipes performed them. */
async function stepsFor(scope: CleanScope): Promise<readonly CleanStep[]> {
  // The runtime testing entrypoint loads compiler code; keep it out of unrelated `./dev` commands.
  const { RuntimeTesting } = await import('@expo-host/testing/runtime-testing')
  const [generated, ...rest] = CHECKOUT_STEPS
  const checkout = [
    { ...generated!, args: [...generated!.args, FS.dirname(RuntimeTesting.TestRunRoot.generatedRoot())] },
    ...rest,
  ]
  return scope === 'all' ? [...checkout, ...ALL_STEPS] : checkout
}

/**
 * run performs one scope's removals and returns the exit code the recipe should take. A step that
 * fails stops the run: the recipes stopped there too, and carrying on would report a clean
 * checkout over a removal that did not happen.
 */
async function run(options: RunCleanOptions = {}): Promise<number> {
  const cwd = options.repositoryRoot ?? Repo.getRoot()
  const now = options.now ?? Date.now
  const runStep = options.runStep ?? defaultRunStep

  for (const step of await stepsFor(options.scope ?? 'checkout')) {
    // Written without a newline, so the finished line reads `<step> ... Done (3.2s)` whether a
    // person watches it complete or reads it afterwards in a log.
    HCI.write(`${step.name} ...`)
    const startedAt = now()
    const exitCode = await runStep(step, cwd)
    const elapsed = OutputText.formatElapsed(now() - startedAt)
    if (exitCode !== 0) {
      HCI.writeLine(` Failed (${elapsed}), exit ${exitCode}`)
      return exitCode
    }
    HCI.writeLine(` Done (${elapsed})`)
  }
  return 0
}

/** defaultRunStep runs one step's own command, letting anything it says reach the terminal. */
async function defaultRunStep(step: CleanStep, cwd: string): Promise<number> {
  const result = await CLI.run(step.command, { args: [...step.args], cwd, stdio: 'inherit' })
  return result.exitCode ?? 1
}

/** CleanCommand owns what `just clean` and `just clean-all` remove, and how they report it. */
export const CleanCommand = { run, stepsFor } as const
