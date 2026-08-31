import { EditorState, type TransactionSpec } from '@codemirror/state'
import { Expect, Test } from '@shared/test'
import type { EditorView } from 'codemirror'
import { StudioSourceNavigation } from '../studio-src/client/StudioEditor'

Test('Studio source navigation opens and centers an absolute preview source range', async () => {
  const state = EditorState.create({ doc: 'view Main() {\n   Text("Hello")\n}\n' })
  const transactions: TransactionSpec[] = []
  let focused = false
  const editor = {
    dispatch(transaction: TransactionSpec) {
      transactions.push(transaction)
    },
    focus() {
      focused = true
    },
    state,
  } as unknown as EditorView
  const openedPaths: string[] = []

  const opened = await StudioSourceNavigation.openAndSelect({
    identity: { path: '/workspace/@ui/Main.tao', sourceVersion: 'source-1' },
    async openFile(path) {
      openedPaths.push(path)
      return {
        editor,
        file: { content: state.doc.toString(), path, sourceVersion: 'source-1' },
      }
    },
    project: '/workspace',
    range: { end: 30, start: 17 },
  })

  Expect(openedPaths).toEqual(['@ui/Main.tao'])
  Expect(opened).toBeDefined()
  Expect(transactions).toHaveLength(1)
  Expect(transactions[0]?.selection).toEqual({ anchor: 17, head: 30 })
  Expect(transactions[0]?.effects).toBeDefined()
  Expect(focused).toBe(true)
})

Test('Studio source navigation accepts project-relative preview paths', async () => {
  const state = EditorState.create({ doc: 'view Main() {}' })
  let openedPath: string | undefined

  const opened = await StudioSourceNavigation.openAndSelect({
    identity: { path: '@ui/Main.tao', sourceVersion: 'source-1' },
    async openFile(path) {
      openedPath = path
      return {
        editor: {
          dispatch() {},
          focus() {},
          state,
        } as unknown as EditorView,
        file: { content: state.doc.toString(), path, sourceVersion: 'source-1' },
      }
    },
    project: '/workspace',
    range: { end: 11, start: 5 },
  })

  Expect(openedPath).toBe('@ui/Main.tao')
  Expect(opened).toBeDefined()
})

Test('Studio source navigation ignores stale, out-of-project, and invalid preview selections', async () => {
  const state = EditorState.create({ doc: 'view Main() {}' })
  let dispatches = 0
  let opens = 0
  const openFile = async (path: string) => {
    opens += 1
    return {
      editor: {
        dispatch() {
          dispatches += 1
        },
        focus() {},
        state,
      } as unknown as EditorView,
      file: { content: state.doc.toString(), path, sourceVersion: 'source-2' },
    }
  }

  const stale = await StudioSourceNavigation.openAndSelect({
    identity: { path: '/workspace/Main.tao', sourceVersion: 'source-1' },
    openFile,
    project: '/workspace',
    range: { end: 10, start: 5 },
  })
  const outside = await StudioSourceNavigation.openAndSelect({
    identity: { path: '/other/Main.tao', sourceVersion: 'source-2' },
    openFile,
    project: '/workspace',
    range: { end: 10, start: 5 },
  })
  const invalid = await StudioSourceNavigation.openAndSelect({
    identity: { path: 'Main.tao', sourceVersion: 'source-2' },
    openFile,
    project: '/workspace',
    range: { end: 100, start: 5 },
  })

  Expect(stale).toBeUndefined()
  Expect(outside).toBeUndefined()
  Expect(invalid).toBeUndefined()
  Expect(opens).toBe(2)
  Expect(dispatches).toBe(0)
})
