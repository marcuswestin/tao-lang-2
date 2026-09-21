import { minimalWatchRoots } from '@expo-host/dev-loop/WatchRoots'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

const REPO_ROOT = '/repo'

Describe('minimalWatchRoots', () => {
  Test('keeps a single root as-is', () => {
    Expect(minimalWatchRoots([FS.resolvePath('Apps/Sample', REPO_ROOT)])).toEqual([
      FS.resolvePath('Apps/Sample', REPO_ROOT),
    ])
  })

  Test('deduplicates a repeated root', () => {
    const root = FS.resolvePath('Apps/Sample', REPO_ROOT)
    Expect(minimalWatchRoots([root, root])).toEqual([root])
  })

  Test('drops a root contained inside another root in the set', () => {
    const roots = minimalWatchRoots([REPO_ROOT, FS.resolvePath('Apps/Sample', REPO_ROOT)])
    Expect(roots).toEqual([REPO_ROOT])
  })

  Test('keeps two unrelated roots', () => {
    const one = FS.resolvePath('Apps/One', REPO_ROOT)
    const two = FS.resolvePath('Apps/Two', REPO_ROOT)
    Expect(minimalWatchRoots([two, one]).toSorted()).toEqual([one, two].toSorted())
  })

  Test('returns nothing for no roots', () => {
    Expect(minimalWatchRoots([])).toEqual([])
  })
})
