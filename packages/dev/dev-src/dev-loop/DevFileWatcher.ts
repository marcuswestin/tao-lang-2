import { FS, Repo } from '@shared'
import chokidar from 'chokidar'
import CommandRunner from './CommandRunner'
import { TUI } from './TUI'

const WATCH_DEBOUNCE_MS = 250

type DebouncedWatcher = {
  close: () => Promise<void>
}

type DevWatcherSpec = {
  label: string
  paths: string[]
  shouldRunParserGen: boolean
}

/** DevFileWatcher watches dev-loop source groups and closes all watcher resources. */
export class DevFileWatcher {
  private readonly watchers: DebouncedWatcher[]

  constructor(appPath: string, onChange: (shouldRunParserGen: boolean) => void) {
    this.watchers = watcherSpecs(appPath).map(spec => startDebouncedWatcher(spec, onChange))
  }

  async close(): Promise<void> {
    await Promise.all(this.watchers.map(watcher => watcher.close()))
  }
}

function startDebouncedWatcher(
  spec: DevWatcherSpec,
  onChange: (shouldRunParserGen: boolean) => void,
): DebouncedWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = chokidar.watch(spec.paths, {
    ignoreInitial: true,
    ignored: shouldIgnoreWatchPath,
  })
  watcher.on('all', (event, path) => {
    TUI.logDevLoop('watch', `${spec.label} ${event}: ${path}`)
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (CommandRunner.isCommandRunning()) {
      TUI.logDevLoop('watch', `Command running; ignored ${spec.label} change.`)
      return
    }
    timer = setTimeout(() => {
      if (CommandRunner.isCommandRunning()) {
        TUI.logDevLoop('watch', `Command running; ignored ${spec.label} change.`)
        return
      }
      onChange(spec.shouldRunParserGen)
    }, WATCH_DEBOUNCE_MS)
  })
  return {
    async close() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      await watcher.close()
    },
  }
}

function watcherSpecs(appPath: string): DevWatcherSpec[] {
  // Watching the whole app folder keeps recompiles working for project files outside the
  // current dependency tree, e.g. newly created or not-yet-imported .tao files.
  const appRoot = FS.dirname(appPath)
  // Separate watcher groups keep grammar generation unconditional for grammar edits and avoid path classification.
  return [
    {
      label: 'grammar',
      paths: [
        Repo.resolvePath('packages/parser/langium-config.json'),
        Repo.resolvePath('packages/parser/parser-grammar'),
      ],
      shouldRunParserGen: true,
    },
    {
      label: 'compile',
      paths: [
        appRoot,
        Repo.resolvePath('Justfile'),
        Repo.resolvePath('packages/ast-utils'),
        Repo.resolvePath('packages/compiler'),
        Repo.resolvePath('packages/dev'),
        Repo.resolvePath('packages/parser/parser-src'),
        Repo.resolvePath('packages/runtime'),
        Repo.resolvePath('packages/shared/shared-src'),
        Repo.resolvePath('packages/tsconfig.base.json'),
        Repo.resolvePath('packages/validator'),
      ],
      shouldRunParserGen: false,
    },
  ]
}

function shouldIgnoreWatchPath(path: string): boolean {
  const normalized = FS.slashPath(path)
  return normalized.includes('/node_modules/')
    || normalized.endsWith('/node_modules')
    || normalized.includes('/.git/')
    || normalized.endsWith('/.git')
    || normalized.includes('/.artifacts/')
    || normalized.endsWith('/.artifacts')
    || normalized.includes('/.expo/')
    || normalized.endsWith('/.expo')
    || normalized.includes('/_gen_')
    || normalized.endsWith('.tsbuildinfo')
    || normalized.endsWith('/ios')
    || normalized.includes('/ios/')
    || normalized.endsWith('/android')
    || normalized.includes('/android/')
}
