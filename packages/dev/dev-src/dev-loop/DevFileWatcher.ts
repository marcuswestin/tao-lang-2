import { FS, HCI } from '@shared'
import chokidar from 'chokidar'
import CommandRunner from './CommandRunner'

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
    ignored: path => shouldIgnoreWatchPath(path),
  })
  watcher.on('all', (event, path) => {
    HCI.logProcessInfo('dev', `${spec.label} ${event}: ${path}`)
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (CommandRunner.isCommandRunning()) {
      HCI.logProcessInfo('dev', `Command running; ignored ${spec.label} change.`)
      return
    }
    timer = setTimeout(() => {
      if (CommandRunner.isCommandRunning()) {
        HCI.logProcessInfo('dev', `Command running; ignored ${spec.label} change.`)
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
  // Separate watcher groups keep grammar generation unconditional for grammar edits and avoid path classification.
  return [
    {
      label: 'grammar',
      paths: [
        FS.repoPath('packages/parser/langium-config.json'),
        FS.repoPath('packages/parser/parser-grammar'),
      ],
      shouldRunParserGen: true,
    },
    {
      label: 'compile',
      paths: [
        appPath,
        FS.repoPath('Justfile'),
        FS.repoPath('packages/ast-utils'),
        FS.repoPath('packages/compiler'),
        FS.repoPath('packages/dev'),
        FS.repoPath('packages/parser/parser-src'),
        FS.repoPath('packages/runtime'),
        FS.repoPath('packages/shared/shared-src'),
        FS.repoPath('packages/tsconfig.base.json'),
        FS.repoPath('packages/validator'),
      ],
      shouldRunParserGen: false,
    },
  ]
}

function shouldIgnoreWatchPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
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
