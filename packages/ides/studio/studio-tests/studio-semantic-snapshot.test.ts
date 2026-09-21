import { buildSemanticSnapshot, Workspace } from '@compiler/workspace'
import { Expect, Test, withTaoFiles } from '@shared/test'

Test('semantic snapshot names a rendered view parameter without inventing a declaration edge', async () => {
  await withTaoFiles('tao-studio-semantic-render-parameter-', {
    'App.tao': `
      use Text from @tao/ui

      app Demo { view Shell(Leaf) }

      view Shell(Content view) {
        render Content()
      }

      view Leaf() { render Text("Leaf") }
    `,
  }, async (paths, root) => {
    const workspace = await Workspace.open(root)
    const validation = await workspace.validate(paths['App.tao'])
    Expect(validation.diagnostics).toEqual([])

    const snapshot = buildSemanticSnapshot(root, 'Demo', validation.files, validation.diagnostics)
    const render = [...snapshot.nodes.values()].find(node => node.kind === 'render' && node.name === 'Content')

    Expect(render).toMatchObject({
      detail: { owner: 'Shell', target: 'Content' },
      kind: 'render',
      name: 'Content',
    })
    Expect(snapshot.edges.filter(edge => edge.from === 'view:Shell' && edge.rel === 'renders')).toEqual([])
  })
})
