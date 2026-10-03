import { Expect, Test } from '@shared/test'
import { StudioAppNavigation } from '../studio-src/client/app/StudioAppNavigation'
import type { StudioFocusedPreview } from '../studio-src/client/StudioMatrixView'

Test('Studio treats the first device selection snapshot as state and only reveals later taps', async () => {
  const opened: string[] = []
  let reveals = 0
  const navigation = new StudioAppNavigation({
    focusedPreview: { focus() {} } as unknown as StudioFocusedPreview,
    focusEditor() {},
    async openFile(path) {
      opened.push(path)
      return undefined
    },
    onReveal() {
      reveals += 1
    },
    previewManifest: () => undefined,
    previews: [],
    project: '/project',
    projectFiles: () => [],
    refreshSearch() {},
    status: { dataset: {}, textContent: '' } as unknown as HTMLElement,
  })
  const remembered = {
    end: 8,
    sequence: 12,
    sourcePath: '/project/Garden.tao',
    sourceVersion: 'text-v1:garden',
    start: 2,
  }

  await navigation.revealDeviceSelection(remembered)
  Expect(opened).toEqual([])
  Expect(reveals).toBe(0)

  await navigation.revealDeviceSelection({ ...remembered, sequence: 13 })
  Expect(opened).toEqual(['Garden.tao'])
  Expect(reveals).toBe(1)
})
