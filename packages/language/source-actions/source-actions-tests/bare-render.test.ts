import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import { parseDocument } from './test-source-actions'

Describe('source actions: bare renders', () => {
  Test('extracts a styled quotation with its reactive parameter and keeps its original spelling', async () => {
    const document = await parseDocument(`
      use Col, Spacer from @tao/ui
      view Main(Heading text) {
        render Col { Spacer "{Heading}" [weight bold] }
      }
    `)
    const selected = AST.streamAllContents(document.parseResult.value).find(AST.isQuotedRender)!
    const cst = selected.$cstNode!
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Banner',
      renderIds: [`${document.uri.fsPath}:${cst.offset}:${cst.end}`],
    })
    Expect(patch.content).toContain('Banner(Heading: Heading)')
    Expect(patch.content).toContain('view Banner(Heading text) {\n   render "{ Heading }" [weight bold]\n}')
    Expect(patch.content).toContain('      Spacer\n')
    const reparsed = await parseDocument(patch.content)
    Expect(reparsed.parseResult.parserErrors).toEqual([])
    Expect(AST.streamAllContents(reparsed.parseResult.value).filter(AST.isQuotedRender).length).toBe(1)
  })

  Test('extracts an adjacent bare leaf without taking the following quotation', async () => {
    const document = await parseDocument('use Col, Spacer from @tao/ui view Main { render Col { Spacer "After" } }')
    const selected = AST.streamAllContents(document.parseResult.value)
      .find(node => AST.isViewRender(node) && node.view?.$refText === 'Spacer')!
    const cst = selected.$cstNode!
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Gap',
      renderIds: [`${document.uri.fsPath}:${cst.offset}:${cst.end}`],
    })
    Expect(patch.content).toContain('view Gap() {\n   render Spacer\n}')
    Expect(patch.content).toContain('      "After"\n')
  })
})
