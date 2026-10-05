import TR from '@runtime/TR'
import { StudioPreview, type StudioPreviewConfig } from '@runtime/TR-studio-preview'
import { act, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'

const config: StudioPreviewConfig = {
  appName: 'Future Design',
  cellId: 'design-cell',
  cellRevision: 7,
  compileRevision: 41,
  manifestRevision: 'design-manifest',
  parentOrigin: 'http://127.0.0.1:4400',
  previewInstanceId: 'design-preview',
  project: '/project',
  sourceVersions: { '/project/App.tao': 'v41' },
}

describe('Studio preview commit acknowledgment', () => {
  test('waits for a future Design consumer to commit before acknowledging its revision', async () => {
    const designPath = '/project/Design.tao'
    const designIdentity = 'studio-suspense-ack-design'
    const definition = { bundles: {}, name: 'Future Design', sizes: {}, tokens: {} }
    const design = TR.Design.Declaration(definition, designIdentity, {
      epoch: 1,
      path: designPath,
      sourceEpochs: { [designPath]: 1 },
    })
    const source = {
      designEpochs: { [designPath]: 2 },
      kind: 'inline' as const,
      path: '/project/App.tao',
      epoch: 2,
    }
    const posted: Array<{ message: Record<string, unknown>; targetOrigin: string }> = []
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const originalParent = Object.getOwnPropertyDescriptor(globalThis, 'parent')
    const originalAddListener = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener')
    const originalRemoveListener = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener')
    const overlay = {
      getAttribute: () => null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
      remove() {},
      setAttribute() {},
      style: {},
    }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener() {},
        body: { appendChild() {} },
        createElement: () => overlay,
        querySelectorAll: () => [],
        removeEventListener() {},
      },
    })
    Object.defineProperty(globalThis, 'parent', {
      configurable: true,
      value: {
        postMessage: (message: Record<string, unknown>, targetOrigin: string) => posted.push({ message, targetOrigin }),
      },
    })
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: () => {} })
    Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: () => {} })

    const FutureDesignConsumer = () => {
      TR.Design.resolve(design, TR.Design.Spec([['fg', '#123456']], source))
      return <Text>Future design committed</Text>
    }
    let screen: ReturnType<typeof render> | undefined
    try {
      screen = render(
        <StudioPreview.PreviewBridge config={config}>
          <FutureDesignConsumer />
        </StudioPreview.PreviewBridge>,
      )
      expect(screen.queryByText('Future design committed')).toBeNull()
      expect(screen.getByText('Loading scenario…')).toBeTruthy()
      expect(posted.filter(({ message }) => message['type'] === 'preview-applied')).toHaveLength(0)

      await act(async () => {
        TR.Design.Declaration(definition, designIdentity, {
          epoch: 2,
          path: designPath,
          sourceEpochs: { [designPath]: 2 },
        })
        await Promise.resolve()
      })
      await waitFor(() => {
        expect(screen!.getByText('Future design committed')).toBeTruthy()
        expect(posted.filter(({ message }) => message['type'] === 'preview-applied')).toHaveLength(1)
      })
      const applied = posted.find(({ message }) => message['type'] === 'preview-applied')!
      expect(applied.targetOrigin).toBe(config.parentOrigin)
      expect(applied.message['appliedRevision']).toBe(41)
      expect(applied.message['compileRevision']).toBe(41)
      expect(applied.message['identity']).toMatchObject({
        cellId: 'design-cell',
        cellRevision: 7,
        compileRevision: 41,
        previewInstanceId: 'design-preview',
      })
      expect(screen.queryByText('Loading scenario…')).toBeNull()
    } finally {
      screen?.unmount()
      for (
        const [key, descriptor] of [
          ['document', originalDocument],
          ['parent', originalParent],
          ['addEventListener', originalAddListener],
          ['removeEventListener', originalRemoveListener],
        ] as const
      ) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor)
        } else {
          Reflect.deleteProperty(globalThis, key)
        }
      }
    }
  })
})
