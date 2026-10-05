import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import { parseDocument } from './test-source-actions'

Describe('source actions: native event controls', () => {
  Test('extracts a controlled render while preserving its local policy and named action binding', async () => {
    const document = await parseDocument(`
      use Button, Col from @tao/ui
      view Main(Save action()) {
        render Col() {
          Button("Save") { on press (preventDefault, stopPropagation) -> Save }
        }
      }
    `)
    const selected = AST.streamAllContents(document.parseResult.value)
      .find(node => AST.isViewRender(node) && node.view?.$refText === 'Button')!
    const cst = selected.$cstNode!
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'GuardedButton',
      renderIds: [`${document.uri.fsPath}:${cst.offset}:${cst.end}`],
    })

    Expect(patch.content).toContain('GuardedButton(Save: Save)')
    Expect(patch.content).toContain('view GuardedButton(Save action())')
    Expect(patch.content).toContain('on press (preventDefault, stopPropagation) -> Save')
    const reparsed = await parseDocument(patch.content)
    Expect(reparsed.parseResult.parserErrors).toEqual([])
    const handler = AST.streamAllContents(reparsed.parseResult.value).find(AST.isEventHandler)!
    Expect(handler.action?.target.ref?.$type).toBe(AST.ParameterDeclaration.$type)
    Expect(handler.controls?.controls.map(control => control.name)).toEqual(['preventDefault', 'stopPropagation'])
  })
})
