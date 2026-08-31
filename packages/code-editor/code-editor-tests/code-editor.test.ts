import { EditorState } from '@codemirror/state'
import { Expect, Test } from '@shared/test'
import TR from 'tao-runtime/TR'
import { codeEditorBaseExtensions, invokeEditorChange } from '../code-editor-src/CodeEditor'

Test('@tao/code-editor installs CodeMirror editing and Tao line-comment language data', () => {
  const state = EditorState.create({ doc: 'view Main() { }', extensions: codeEditorBaseExtensions })
  Expect(state.languageDataAt<{ line?: string }>('commentTokens', 0)).toEqual([{ line: '//' }])
})

Test('@tao/code-editor invokes its Tao Change action with a runtime text value', async () => {
  const received: string[] = []
  const change = TR.Action((value: TR.Value<string>) => received.push(value.evaluate().jsValue)).jsValue

  await invokeEditorChange(change, 'updated Tao')

  Expect(received).toEqual(['updated Tao'])
})
