import { Describe, Expect, Test } from '@shared/test'
import { type StudioLensNode, StudioSyntaxLens } from '../studio-src/StudioSyntaxLens'

const source = [
  'use Col, Text from @tao/ui',
  '',
  '// The screen.',
  'view Settings() {',
  '   Title "Settings"',
  '   state Expanded = true',
  '   action Reset() {',
  '      set Expanded = false',
  '   }',
  '   render Col() [screen, gapWide] {',
  '      #hero',
  '      Text("Hello") [title] // trailing',
  '      Button("Reset") [buttonDanger] {',
  '         on press Reset',
  '      }',
  '      Button("Close") {',
  '         on press -> { set Expanded = false }',
  '      }',
  '      when Expanded {',
  '         true -> { Text("Open") }',
  '         otherwise -> { Text("Closed") }',
  '      }',
  '   }',
  '}',
  '',
  'let Goal is number = 10',
  '',
  'type Prompt is {',
  '   PromptTitle',
  '}',
  '',
].join('\n')

function text(node: StudioLensNode | undefined): string | undefined {
  return node === undefined ? undefined : source.slice(node.from, node.to)
}

function body(node: StudioLensNode | undefined): string | undefined {
  return node?.body === undefined ? undefined : source.slice(node.body.from, node.body.to)
}

function kinds(nodes: readonly StudioLensNode[]): string[] {
  return nodes.map(node => node.kind)
}

Describe('Studio syntax lens', () => {
  const map = StudioSyntaxLens.classifySource(source)
  const [use, comment, view, binding, type] = map.nodes

  Test('classifies file statements into facets in document order', () => {
    Expect(map.complete).toBe(true)
    Expect(kinds(map.nodes)).toEqual(['use', 'comment', 'view', 'binding', 'type'])
    Expect(map.nodes.map(node => node.facet)).toEqual(['wiring', 'comments', 'structure', 'data', 'data'])
    Expect(map.nodes.map(node => node.collapse)).toEqual(['vanish', 'vanish', 'head', 'head', 'head'])
    Expect(text(use)).toBe('use Col, Text from @tao/ui')
    Expect(text(comment)).toBe('// The screen.')
  })

  Test('keeps a declaration head and glyphs its body', () => {
    Expect(text(view)?.startsWith('view Settings() {')).toBe(true)
    Expect(body(view)).toBe(source.slice(source.indexOf('{'), source.indexOf('\n}\n') + 2))
    Expect(body(binding)).toBe('is number = 10')
    Expect(body(type)).toBe('is {\n   PromptTitle\n}')
  })

  Test('nests view members and leaves action statements inside the action body', () => {
    Expect(kinds(view!.children)).toEqual(['slot-fill', 'state', 'action', 'render'])
    const action = view!.children[2]
    Expect(action?.facet).toBe('behavior')
    Expect(body(action)).toBe('{\n      set Expanded = false\n   }')
    Expect(action?.children).toEqual([])
  })

  Test('places layout, tags, comments, and child renders under the render they belong to', () => {
    const render = view!.children[3]
    Expect(kinds(render!.children)).toEqual(['layout', 'tag', 'render', 'comment', 'render', 'render', 'render-flow'])
    Expect(body(render!.children[0])).toBe('screen, gapWide')
    Expect(text(render!.children[3])).toBe('// trailing')
    Expect(kinds(render!.children[2]!.children)).toEqual(['layout'])
  })

  Test('keeps an event handler head in both handler forms', () => {
    const render = view!.children[3]
    const reference = render!.children[4]!.children.find(node => node.kind === 'handler')
    const inline = render!.children[5]!.children.find(node => node.kind === 'handler')
    Expect(reference?.facet).toBe('behavior')
    Expect(text(reference)).toBe('on press Reset')
    Expect(body(reference)).toBe('Reset')
    Expect(body(inline)).toBe('-> { set Expanded = false }')
  })

  Test('makes render branches their own vanishing nodes so an empty branch disappears with its content', () => {
    const flow = view!.children[3]!.children[6]
    Expect(kinds(flow!.children)).toEqual(['render-branch', 'render-branch'])
    Expect(flow!.children.map(branch => kinds(branch.children))).toEqual([['render'], ['render']])
  })

  Test('marks a recovering parse incomplete', () => {
    Expect(StudioSyntaxLens.classifySource('view Main( {\n').complete).toBe(false)
  })

  Test('rejects a request without source content', () => {
    Expect(() => StudioSyntaxLens.classify({})).toThrow('Expected Tao source content')
  })
})
