import { buildSemanticSnapshot, Workspace } from '@compiler/workspace'
import { Expect, Test, withTaoFiles } from '@shared/test'

Test('semantic snapshot names a rendered view parameter without inventing a declaration edge', async () => {
  await withTaoFiles('tao-studio-semantic-render-parameter-', {
    'App.tao': `
      use Text from @tao/ui

      app Demo { id "demo" version "1.0.0" name "Demo" view Shell(Leaf) }

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

Test('semantic snapshot records projected input fields as bulk update writes', async () => {
  await withTaoFiles('tao-studio-semantic-projected-update-', {
    'App.tao': `
      use Text from @tao/ui
      data Documents / Document { Title text, Body text, Owner text }
      type DocumentInput is Document { Title, Body }
      app Demo { id "demo" version "1.0.0" name "Demo" view Main }
      view Main() { render Text("Main") }
      view Editor(Document) {
        state Input = copy Document as DocumentInput
        action Save() { update Document with Input }
        render Text("Editor")
      }
    `,
  }, async (paths, root) => {
    const workspace = await Workspace.open(root)
    const validation = await workspace.validate(paths['App.tao'])
    Expect(validation.diagnostics).toEqual([])

    const snapshot = buildSemanticSnapshot(root, 'Demo', validation.files, validation.diagnostics)
    const writes = snapshot.edges
      .filter(edge => edge.from === 'action:Editor.Save' && edge.rel === 'writes')
      .map(edge => edge.to)

    Expect(writes).toEqual(['field:Document.Title', 'field:Document.Body'])
  })
})

Test('semantic snapshot records projected input fields as create writes', async () => {
  await withTaoFiles('tao-studio-semantic-projected-create-', {
    'App.tao': `
      use Text from @tao/ui
      data Notes / Note { Title text, Topic text, Summary text (default "") }
      type NoteInput is Note { Title, Topic }
      app Demo { id "demo" version "1.0.0" name "Demo" view Main }
      view Main() {
        state Input = NoteInput { Title: "", Topic: "" }
        action Add() { create Note with Input }
        render Text("Main")
      }
    `,
  }, async (paths, root) => {
    const workspace = await Workspace.open(root)
    const validation = await workspace.validate(paths['App.tao'])
    Expect(validation.diagnostics).toEqual([])

    const snapshot = buildSemanticSnapshot(root, 'Demo', validation.files, validation.diagnostics)
    const writes = snapshot.edges
      .filter(edge => edge.from === 'action:Main.Add' && edge.rel === 'writes')
      .map(edge => edge.to)

    Expect(writes).toEqual(['field:Note.Title', 'field:Note.Topic'])
  })
})
