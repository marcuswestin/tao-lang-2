import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: render prefixes', () => {
  Test('attaches same-line and reversed multiline metadata to only the next occurrence', async () => {
    const parsed = await testParseCode(`
      view Main {
        render Host {
          #first accessible label "First" Leaf
          accessible label "Second"
          #second
          Leaf
          Leaf
        }
      }
      view Host { render Leaf }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const root = AST.streamAllContents(parsed.entry.ast).find(AST.isRenderStatement)!
    const children = root.block!.statements.filter(AST.isViewRender)
    Expect(children.length).toBe(3)
    Expect(children.map(AST.testTagForRender)).toEqual(['first', 'second', undefined])
    Expect(children.map(child => AST.renderPrefixCluster(child).map(prefix => prefix.$type))).toEqual([
      ['TagStatement', 'RenderAccessibilityStatement'],
      ['RenderAccessibilityStatement', 'TagStatement'],
      [],
    ])
    const prefixes = root.block!.statements.filter(AST.isRenderAccessibilityStatement)
    Expect(AST.renderPrefixTarget(prefixes[0]!) === children[0]).toBe(true)
    Expect(AST.renderPrefixTarget(prefixes[1]!) === children[1]).toBe(true)
  })

  Test('preserves dynamic expression boundaries before bare views and grouped quotations', async () => {
    const parsed = await testParseSyntax(`
      view Main {
        state Caption is text = "Library"
        render Col {
          accessible label Caption Leaf
          a11y label (Caption) "Quoted child"
          accessible label "Literal label" "Literal child"
        }
      }
      view Col { render Leaf }
      view Text(Value text) { render Leaf }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const root = AST.streamAllContents(parsed.entry.ast).find(AST.isRenderStatement)!
    Expect(root.block!.statements.map(statement => statement.$type)).toEqual([
      'RenderAccessibilityStatement',
      'ViewRender',
      'RenderAccessibilityStatement',
      'ViewRender',
      'RenderAccessibilityStatement',
      'ViewRender',
    ])
    const prefixes = root.block!.statements.filter(AST.isRenderAccessibilityStatement)
    Expect(prefixes.map(prefix => prefix.value.$type)).toEqual(['ValueReference', 'ValueReference', 'StringLiteral'])
    Expect(prefixes.map(prefix => prefix.spelling)).toEqual(['accessible', 'a11y', 'accessible'])
    const children = root.block!.statements.filter(AST.isViewRender)
    Expect(children[0]!.view.$refText).toBe('Leaf')
    Expect(children.slice(1).map(AST.isQuotedRender)).toEqual([true, true])
    Expect(children.slice(1).map(child => child.argumentList!.arguments[0]!.value.$cstNode!.text)).toEqual([
      '"Quoted child"',
      '"Literal child"',
    ])
  })

  Test('retains an actual constructor expression instead of guessing a quoted target', async () => {
    for (const gap of [' ', '\n']) {
      const parsed = await testParseSyntax(`
        type Caption is text
        view Main { accessible label Caption${gap}"Constructed" render "Target" }
      `)
      const prefix = AST.streamAllContents(parsed.entry.ast).find(AST.isRenderAccessibilityStatement)!
      Expect(prefix.value.$type).toBe('ConfigurationConstructor')
      Expect(prefix.value.$cstNode!.text.replace(/\s+/g, ' ')).toBe('Caption "Constructed"')
      Expect(AST.renderPrefixTarget(prefix)!.$type).toBe('RenderStatement')
    }
  })

  Test('does not cross setup or nested block boundaries', async () => {
    const parsed = await testParseSyntax(`
      view Main { render Host {
        accessible label "Dangling" let Gap = "Gap" Leaf
        #container accessible label "Container" Host { Leaf }
        Leaf
      } }
      view Host { render Leaf }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const root = AST.streamAllContents(parsed.entry.ast).find(AST.isRenderStatement)!
    const children = root.block!.statements.filter(AST.isViewRender)
    const prefix = root.block!.statements.find(AST.isRenderAccessibilityStatement)!
    Expect(AST.renderPrefixTarget(prefix)!.$type).toBe('AliasDeclaration')
    Expect(AST.renderPrefixCluster(children[0]!)).toEqual([])
    Expect(AST.testTagForRender(children[1]!)).toBe('container')
    Expect(AST.renderPrefixCluster(children[1]!.block!.statements[0] as AST.ViewRender)).toEqual([])
    Expect(AST.renderPrefixCluster(children[2]!)).toEqual([])
  })
})
