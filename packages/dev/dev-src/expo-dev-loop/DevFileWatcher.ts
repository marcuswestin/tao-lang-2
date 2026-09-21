import { Repo } from '@shared'
import CommandRunner from './CommandRunner'
import {
  type DebouncedWatcher,
  startDebouncedWatcher as startGenericDebouncedWatcher,
  WATCH_DEBOUNCE_MS,
} from './DebouncedWatcher'
import { DevLoopTUI } from './DevLoopTUI'

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
        DevLoopTUI.logDevLoop('watch', `Command running; ignored ${spec.label} change.`)
        return
      }
      onChange(spec.shouldRunParserGen)
    },
    {
      debounceMs: WATCH_DEBOUNCE_MS,
      onEvent: (event, path) => DevLoopTUI.logDevLoop('watch', `${spec.label} ${event}: ${path}`),
      shouldDrop: () => {
        if (!CommandRunner.isCommandRunning()) {
          return false
        }
        DevLoopTUI.logDevLoop('watch', `Command running; ignored ${spec.label} change.`)
        return true
      },
    },
  )
}

function watcherSpecs(projectRoot: string): DevWatcherSpec[] {
  // Watching the whole project keeps recompiles working for project files outside the
  // current dependency tree, e.g. newly created or not-yet-imported .tao files.
  // Separate watcher groups keep grammar generation unconditional for grammar edits and avoid path classification.
  return [
    {
      label: 'grammar',
      paths: [
        Repo.resolvePath('packages/language/parser/langium-config.json'),
        Repo.resolvePath('packages/language/parser/parser-grammar'),
      ],
      shouldRunParserGen: true,
    },
    {
      label: 'compile',
      paths: [
        projectRoot,
        Repo.resolvePath('Justfile'),
        Repo.resolvePath('packages/language/ast-utils'),
        Repo.resolvePath('packages/compiler'),
        Repo.resolvePath('packages/dev'),
        Repo.resolvePath('packages/language/parser/parser-src'),
        Repo.resolvePath('packages/apps/runtime'),
        Repo.resolvePath('packages/apps/expo-host'),
        Repo.resolvePath('packages/shared/shared-src'),
        Repo.resolvePath('packages/apps/stdlib'),
        Repo.resolvePath('packages/tsconfig.base.json'),
        Repo.resolvePath('packages/language/validator'),
      ],
      shouldRunParserGen: false,
    },
  ]
}
