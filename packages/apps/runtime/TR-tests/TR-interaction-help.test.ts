import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { InteractionAttention } from '../TaoRuntime-src/TR-interaction-attention'
import { CommandCatalog } from '../TaoRuntime-src/TR-interaction-catalog'
import { contextualHelp } from '../TaoRuntime-src/TR-interaction-help'
import { InteractionOutline } from '../TaoRuntime-src/TR-interaction-outline'

Describe('TR.Interaction contextual Help', () => {
  Test('derives region, highlighted target, description, and invocation only while narrowing', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    outline.register({
      identity: 'documents',
      kind: 'region',
      label: () => 'Documents',
      live: { primary: true },
      provenance: {},
    })
    outline.register({
      corpus: () => ['Draft'],
      identity: 'draft',
      kind: 'item',
      label: () => 'Draft',
      live: {},
      parent: 'documents',
      provenance: {},
    })
    const archive = TR.Interaction.Command({
      action: () => TR.Action(() => undefined),
      members: { Key: () => TR.Value('a'), Title: () => TR.Value('Archive') },
      name: 'Archive',
    })
    catalog.register({
      commands: [{
        command: () => archive,
        identity: 'Archive',
        name: 'Archive',
        scope: { kind: 'module' },
        slots: [],
        static: { description: 'Move the draft to the archive.', key: 'a', title: 'Archive' },
      }],
      module: 'Commands',
    })
    catalog.registerSurface({ commands: [archive], hidden: [], identity: 'Draft actions' }, 'draft')
    attention.revalidateOutline()
    Expect(contextualHelp(attention.read(), catalog, outline)).toBeUndefined()

    attention.narrow('dra')
    Expect(contextualHelp(attention.read(), catalog, outline)).toEqual({
      actions: [{
        description: 'Move the draft to the archive.',
        enabled: true,
        invocation: '. then A',
        label: 'Archive',
      }],
      region: 'Documents',
      target: 'Draft',
    })

    outline.register({
      corpus: () => ['Draft copy'],
      identity: 'draft-copy',
      kind: 'item',
      label: () => 'Draft copy',
      live: {},
      parent: 'documents',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.pressKey('ArrowDown')
    Expect(contextualHelp(attention.read(), catalog, outline)?.target).toBe('Draft copy')

    attention.pressKey('Escape')
    Expect(contextualHelp(attention.read(), catalog, outline)).toBeUndefined()

    outline.register({
      corpus: () => ['Editor'],
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: { engage: () => undefined },
      parent: 'documents',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.narrow('edit')
    Expect(contextualHelp(attention.read(), catalog, outline)?.target).toBe('Editor')
    attention.engage('editor')
    Expect(contextualHelp(attention.read(), catalog, outline)).toBeUndefined()
  })
})
