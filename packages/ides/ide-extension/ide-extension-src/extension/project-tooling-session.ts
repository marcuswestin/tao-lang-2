import type { ProjectToolingOptions, ProjectToolingResult, ProjectToolingWatch } from '@project-tooling'
import { FS } from '@shared'

type WatchProject = (root: string, options: ProjectToolingOptions) => Promise<ProjectToolingWatch>

/** One disk watch per marked project, with serialized folder reconciliation and shutdown. */
export function createProjectToolingSession(
  watchProject: WatchProject,
  onResult: (result: ProjectToolingResult) => void,
  onRemove: (root: string) => void,
  onError: (root: string, error: unknown) => void,
  options: Omit<ProjectToolingOptions, 'onResult' | 'onError'> = {},
): {
  reconcile(roots: readonly string[]): Promise<void>
  roots(): string[]
  result(root: string): ProjectToolingResult | undefined
  dispose(): Promise<void>
} {
  const watches = new Map<string, ProjectToolingWatch>()
  const active = new Map<string, symbol>()
  let pending: Promise<void> = Promise.resolve()
  let disposed = false

  const queue = (work: () => Promise<void>): Promise<void> => {
    pending = pending.catch(() => undefined).then(work)
    return pending
  }

  return {
    reconcile(roots) {
      const wanted = new Set(roots.map(root => FS.resolvePath(root)))
      return queue(async () => {
        if (disposed) {
          return
        }
        for (const [root, watch] of watches) {
          if (wanted.has(root)) {
            continue
          }
          active.delete(root)
          watches.delete(root)
          try {
            await watch.dispose()
          } catch (error) {
            onError(root, error)
          }
          onRemove(root)
        }
        for (const root of wanted) {
          if (watches.has(root)) {
            continue
          }
          const identity = Symbol(root)
          active.set(root, identity)
          let delivered = false
          try {
            const watch = await watchProject(root, {
              ...options,
              onResult: result => {
                if (active.get(root) === identity && !disposed) {
                  delivered = true
                  onResult(result)
                }
              },
              onError: error => {
                if (active.get(root) === identity && !disposed) {
                  onError(root, error)
                }
              },
            })
            if (disposed || !wanted.has(root)) {
              active.delete(root)
              await watch.dispose()
            } else {
              watches.set(root, watch)
              if (!delivered) {
                onResult(watch.lastResult)
              }
            }
          } catch (error) {
            active.delete(root)
            onError(root, error)
          }
        }
      })
    },
    result(root) {
      return watches.get(FS.resolvePath(root))?.lastResult
    },
    roots() {
      return [...watches.keys()]
    },
    dispose() {
      disposed = true
      return queue(async () => {
        active.clear()
        await Promise.all([...watches.values()].map(watch => watch.dispose()))
        watches.clear()
      })
    },
  }
}
