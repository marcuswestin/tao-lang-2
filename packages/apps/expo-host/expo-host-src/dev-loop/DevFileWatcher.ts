import { Repo } from '@shared'
import { RuntimeToolchainPaths } from '../runtime-toolchain-paths'
import CommandRunner from './CommandRunner'
import {
  type DebouncedWatcher,
  startDebouncedWatcher as startGenericDebouncedWatcher,
  WATCH_DEBOUNCE_MS,
} from './DebouncedWatcher'
import { DevLoopOutput } from './DevLoopOutput'

type DevWatcherSpec = {
  label: string
  paths: string[]
  shouldRunParserGen: boolean
}

/** DevFileWatcher watches dev-loop source groups and closes all watcher resources. */
export class DevFileWatcher {
  private readonly watchers: DebouncedWatcher[]

  constructor(projectRoot: string, onChange: (shouldRunParserGen: boolean) => void) {
    this.watchers = watcherSpecs(projectRoot).map(spec => startDebouncedWatcher(spec, onChange))
  }

  async close(): Promise<void> {
    await Promise.all(this.watchers.map(watcher => watcher.close()))
  }
}

function startDebouncedWatcher(
  spec: DevWatcherSpec,
  onChange: (shouldRunParserGen: boolean) => void,
): DebouncedWatcher {
  return startGenericDebouncedWatcher(
    spec.paths,
    () => {
      if (CommandRunner.isCommandRunning()) {
        DevLoopOutput.logDevLoop('watch', `Command running; ignored ${spec.label} change.`)
        return
      }
      onChange(spec.shouldRunParserGen)
    },
    {
      debounceMs: WATCH_DEBOUNCE_MS,
      onEvent: (event, path) => DevLoopOutput.logDevLoop('watch', `${spec.label} ${event}: ${path}`),
      shouldDrop: () => {
        if (!CommandRunner.isCommandRunning()) {
          return false
        }
        DevLoopOutput.logDevLoop('watch', `Command running; ignored ${spec.label} change.`)
        return true
      },
    },
  )
}

function watcherSpecs(projectRoot: string): DevWatcherSpec[] {
  const toolchainRepo = Repo.tryGetRoot(RuntimeToolchainPaths.packageRoot)
  if (toolchainRepo === undefined) {
    return [{ label: 'compile', paths: [projectRoot], shouldRunParserGen: false }]
  }
  const repoPath = (path: string) => Repo.resolvePath(path, toolchainRepo)
  // Watching the whole project keeps recompiles working for project files outside the
  // current dependency tree, e.g. newly created or not-yet-imported .tao files.
  // Separate watcher groups keep grammar generation unconditional for grammar edits and avoid path classification.
  return [
    {
      label: 'grammar',
      paths: [
        repoPath('packages/language/parser/langium-config.json'),
        repoPath('packages/language/parser/parser-grammar'),
      ],
      shouldRunParserGen: true,
    },
    {
      label: 'compile',
      paths: [
        projectRoot,
        repoPath('Justfile'),
        repoPath('packages/language/ast-utils'),
        repoPath('packages/compiler'),
        // `tao dev`'s own reporter and command wiring, which this loop runs through
        // (`@expo-host/dev-loop/expo-dev-loop` is called only from `packages/cli/tao-cli`); the
        // dev loop's own code under `packages/apps/expo-host` is already covered below.
        repoPath('packages/cli/tao-cli/cli-src/dev'),
        repoPath('packages/language/parser/parser-src'),
        repoPath('packages/apps/runtime'),
        repoPath('packages/apps/expo-host'),
        repoPath('packages/shared/shared-src'),
        repoPath('packages/apps/stdlib'),
        repoPath('packages/tsconfig.base.json'),
        repoPath('packages/language/validator'),
      ],
      shouldRunParserGen: false,
    },
  ]
}
