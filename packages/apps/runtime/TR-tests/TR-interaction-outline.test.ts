import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { labelCorpus, primaryLabel } from '../TaoRuntime-src/TR-interaction-labels'
import {
  describeOutlineTable,
  InteractionOutline,
  resetInteractionOutline,
  type TaoOutlineLoopNode,
} from '../TaoRuntime-src/TR-interaction-outline'

const documents: TaoOutlineLoopNode = Object.freeze({
  collection: 'Drafts',
  declaration: 'WorkspaceDetail',
  entity: 'Document',
  identity: '@ui/Workspaces#WorkspaceDetail#7846',
  kind: 'collection',
  name: 'Document',
  root: 'single',
  selectable: false,
  texts: [['Title'], ['Body']],
})

function countedRow(fields: Record<string, string>): { reads: Record<string, number>; row: Record<string, unknown> } {
  const reads: Record<string, number> = {}
  const row: Record<string, unknown> = { Id: 'a' }
  for (const [name, value] of Object.entries(fields)) {
    reads[name] = 0
    Object.defineProperty(row, name, {
      enumerable: true,
      get: () => {
        reads[name] = (reads[name] ?? 0) + 1
        return value
      },
    })
  }
  return { reads, row }
}

function item(outline: InteractionOutline, identity: string, row: Record<string, unknown>): () => void {
  return outline.register({
    corpus: () => labelCorpus(documents, row),
    identity,
    kind: 'item',
    label: () => primaryLabel(documents, row, 0),
    parent: 'collection#1',
    provenance: { entity: 'Document', handle: String(row['Id']) },
  })
}

async function settled(): Promise<void> {
  await Promise.resolve()
}

Describe('TR.Interaction.Outline', () => {
  Test('describes a module table with module-qualified identities and keeps every node frozen', () => {
    const table = describeOutlineTable({
      module: '@ui/Workspaces',
      nodes: {
        'Main#12': {
          declaration: 'Main',
          kind: 'control',
          label: 'Save',
          nameStatus: 'known',
          role: 'action',
          view: 'FormButton',
        },
        'Main#40': {
          declaration: 'Main',
          kind: 'collection',
          name: 'Row',
          root: 'single',
          selectable: false,
          texts: [],
        },
      },
    })

    Expect(table['Main#12'].identity).toBe('@ui/Workspaces#Main#12')
    Expect(table['Main#40'].identity).toBe('@ui/Workspaces#Main#40')
    Expect(table['Main#12'].role).toBe('action')
    Expect(Object.isFrozen(table['Main#40'])).toBe(true)
  })

  Test('registers nodes for exactly as long as their owner keeps the withdrawal', () => {
    const outline = new InteractionOutline()
    const withdraw = outline.register({
      identity: 'collection#1',
      kind: 'collection',
      label: () => 'Drafts',
      provenance: { entity: 'Document', loop: documents.identity },
    })
    const withdrawRow = item(outline, 'collection#1/a', { Id: 'a', Title: 'Chapter one' })

    Expect(outline.read().nodes.map(node => [node.identity, node.kind, node.label, node.parent])).toEqual([
      ['collection#1', 'collection', 'Drafts', undefined],
      ['collection#1/a', 'item', 'Chapter one', 'collection#1'],
    ])

    withdrawRow()
    Expect(outline.read().nodes.map(node => node.identity)).toEqual(['collection#1'])
    withdraw()
    Expect(outline.mounted).toBe(0)
  })

  Test('reads only the primary label without a subscriber, never the corpus', () => {
    const outline = new InteractionOutline()
    const { reads, row } = countedRow({ Body: 'It began at sea.', Title: 'Chapter one' })
    item(outline, 'collection#1/a', row)
    outline.refresh()

    // Mounting registers existence; nothing evaluated the row.
    Expect(reads).toEqual({ Body: 0, Title: 0 })

    // The primary label is what accessibility needs: one text, the first that ranks.
    Expect(primaryLabel(documents, row, 0)).toBe('Chapter one')
    Expect(reads).toEqual({ Body: 0, Title: 1 })

    // A reader's snapshot is what evaluates the corpus.
    const snapshot = outline.read()
    Expect(snapshot.nodes[0]?.corpus).toEqual(['Chapter one', 'It began at sea.'])
    Expect(reads['Body']).toBe(1)
  })

  Test('notifies a subscriber only when what it would read has changed', async () => {
    const outline = new InteractionOutline()
    let title = 'Chapter one'
    const row: Record<string, unknown> = { Id: 'a' }
    Object.defineProperty(row, 'Title', { enumerable: true, get: () => title })
    item(outline, 'collection#1/a', row)
    let notifications = 0
    const unsubscribe = outline.subscribe(() => {
      notifications += 1
    })
    const revision = outline.snapshot()

    outline.refresh()
    outline.refresh()
    await settled()
    Expect(notifications).toBe(0)
    Expect(outline.snapshot()).toBe(revision)

    title = 'Chapter two'
    outline.refresh()
    await settled()
    Expect(notifications).toBe(1)
    Expect(outline.snapshot()).toBe(revision + 1)
    Expect(outline.read().nodes[0]?.label).toBe('Chapter two')

    unsubscribe()
    title = 'Chapter three'
    outline.refresh()
    await settled()
    Expect(notifications).toBe(1)
  })

  Test('coalesces live capability baselines across a burst of registrations', async () => {
    const outline = new InteractionOutline()
    let enabled = true
    let reads = 0
    let notifications = 0
    const unsubscribe = outline.subscribeLive(() => notifications += 1)

    for (let index = 0; index < 100; index += 1) {
      outline.register({
        identity: `control#${index}`,
        kind: 'action',
        label: () => `Control ${index}`,
        live: {
          enabled: () => {
            reads += 1
            return enabled
          },
        },
        provenance: {},
      })
    }

    Expect(reads).toBe(0)
    Expect(notifications).toBe(100)
    await settled()
    Expect(reads).toBe(100)

    reads = 0
    enabled = false
    outline.refreshLive()
    await settled()
    Expect(reads).toBe(100)
    Expect(notifications).toBe(101)
    unsubscribe()
  })

  Test('keeps an item its identity and provenance across a reorder', () => {
    const outline = new InteractionOutline()
    const rows = [{ Id: 'a', Title: 'Alpha' }, { Id: 'b', Title: 'Beta' }]
    const withdraws = rows.map(row => item(outline, `collection#1/${row.Id}`, row))
    const before = outline.read().nodes.map(node => [node.identity, node.provenance])

    for (const withdraw of withdraws) {
      withdraw()
    }
    for (const row of [...rows].reverse()) {
      item(outline, `collection#1/${row.Id}`, row)
    }
    const after = outline.read().nodes.map(node => [node.identity, node.provenance])

    Expect(before).toEqual([
      ['collection#1/a', { entity: 'Document', handle: 'a' }],
      ['collection#1/b', { entity: 'Document', handle: 'b' }],
    ])
    Expect([...after].sort()).toEqual([...before].sort())
  })

  Test('reads the process-wide outline as plain JSON and clears it at the check boundary', () => {
    const outline = TR.Interaction.Outline
    const withdraw = outline.register({
      identity: 'region#1',
      kind: 'region',
      label: () => 'Workspaces',
      provenance: { key: 'workspaces', navigation: 'Main' },
    })

    Expect(JSON.parse(JSON.stringify(outline.read()))).toEqual({
      nodes: [{
        identity: 'region#1',
        kind: 'region',
        label: 'Workspaces',
        provenance: { key: 'workspaces', navigation: 'Main' },
      }],
    })

    // The check boundary calls this beside the navigation reset; the runtime suite proves both the
    // boundary and the `interaction` capture domain against a whole mounted app.
    resetInteractionOutline()
    Expect(outline.mounted).toBe(0)
    withdraw()
  })
})

Describe('TR.Interaction row labels', () => {
  Test('falls through the ranked texts to the title field, the text itself, and the entity handle', () => {
    const untitled: TaoOutlineLoopNode = { ...documents, texts: [['Body']] }
    Expect(primaryLabel(documents, { Id: 'a', Title: '', Body: 'It began at sea.' }, 0)).toBe('It began at sea.')
    Expect(primaryLabel(untitled, 'Plain row', 2)).toBe('Plain row')
    Expect(primaryLabel({ ...documents, texts: [] }, { Id: 'a' }, 3)).toBe('Document 4')
    Expect(primaryLabel({ ...documents, texts: [['Workspace', 'Name']] }, { Workspace: { Name: 'Home' } }, 0)).toBe(
      'Home',
    )
  })

  Test('collects every rendered text once as the corpus', () => {
    const corpus = labelCorpus({ ...documents, texts: [['Title'], ['Body'], ['Title']] }, {
      Body: 'It began at sea.',
      Title: 'Chapter one',
    })
    Expect(corpus).toEqual(['Chapter one', 'It began at sea.'])
    Expect(labelCorpus(documents, 'Plain row')).toEqual(['Plain row'])
  })
})
