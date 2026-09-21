import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { CommandCatalog } from '../TaoRuntime-src/TR-interaction-catalog'

Describe('TR.Interaction', () => {
  Test('reads a command through its declared members and falls back from Label to Title', () => {
    let invoked = 0
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(() => {
          invoked += 1
        }),
      members: {
        Enabled: () => TR.Value(false),
        Icon: () => TR.Value('checkmark'),
        Title: () => TR.Value('Save document'),
      },
      name: 'Save',
    })

    const snapshot = command.read()
    Expect(snapshot.label).toBe('Save document')
    Expect(snapshot.icon).toBe('checkmark')
    Expect(snapshot.enabled).toBe(false)
    command.evaluate().jsValue.invoke()
    Expect(invoked).toBe(1)
  })

  Test('runs a command joined, which is what `do <command>` needs and a frozen invoke never had', async () => {
    const invoked: string[] = []
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(async () => {
          invoked.push('ran')
        }),
      members: { Title: () => TR.Value('Finish') },
      name: 'Finish',
    })

    await TR.Do(command)

    Expect(invoked).toEqual(['ran'])
  })

  Test('binds a slot at the invocation and refines only the words that binding changed', () => {
    const seen: string[] = []
    const command = TR.Interaction.Command({
      action: fills => TR.Action(() => seen.push(String(fills['Document']?.evaluate().jsValue))),
      members: {
        Icon: () => TR.Value('checkmark.circle'),
        Title: () => TR.Value('Finish document'),
      },
      name: 'Finish',
      slots: ['Document'],
    })

    Expect(command.unfilledSlots()).toEqual(['Document'])
    const bound = TR.Interaction.Bind(command, { Document: TR.Value('draft') }, { Icon: () => TR.Value('star') })
    Expect(bound.unfilledSlots()).toEqual([])
    Expect(bound.read().icon).toBe('star')
    Expect(bound.read().label).toBe('Finish document')
    Expect(command.read().icon).toBe('checkmark.circle')
    bound.evaluate().jsValue.invoke()
    Expect(seen).toEqual(['draft'])
  })

  Test(
    'takes the values for its open slots as positional arguments, which is how `do Finish(Document)` runs',
    async () => {
      const seen: string[] = []
      const command = TR.Interaction.Command({
        action: fills =>
          TR.Action(() => {
            seen.push(`${fills['Document']?.evaluate().jsValue}:${fills['Workspace']?.evaluate().jsValue}`)
          }),
        members: { Title: () => TR.Value('Move') },
        name: 'Move',
        slots: ['Document', 'Workspace'],
      })

      await TR.Do(command, TR.Value('draft'), TR.Value('home'))
      const bound = TR.Interaction.Bind(command, { Document: TR.Value('bound') })
      // A bound command takes exactly the slots its binding left open, in slot order.
      bound.evaluate().jsValue.invoke(TR.Value('archive'))
      // A surface runs the command as bound; nothing a host hands its press handler is a slot.
      bound.read().invoke()

      Expect(seen).toEqual(['draft:home', 'bound:archive', 'bound:undefined'])
      Expect(command.unfilledSlots()).toEqual(['Document', 'Workspace'])
    },
  )

  Test('answers which commands act on an entity and which need nothing selected', () => {
    const catalog = new CommandCatalog()
    const table = (
      module: string,
      name: string,
      slots: readonly { entity: boolean; name: string; required: boolean; type: string }[],
    ) => ({
      commands: [{
        command: () => TR.Interaction.Command({ action: () => TR.Action(() => undefined), name }),
        identity: `${module}.${name}`,
        name,
        scope: { kind: 'module' as const },
        slots,
        static: {},
      }],
      module,
    })

    catalog.register(
      table('@ui/Documents', 'Finish', [{ entity: true, name: 'Document', required: true, type: 'Document' }]),
    )
    catalog.register(
      table('@ui/Workspaces', 'Rename', [{ entity: true, name: 'Workspace', required: true, type: 'Workspace' }]),
    )
    const withdraw = catalog.register(table('@ui/Shell', 'NewDocument', []))

    Expect(catalog.applicable('Document').map(entry => entry.name)).toEqual(['Finish'])
    Expect(catalog.applicable('Workspace').map(entry => entry.name)).toEqual(['Rename'])
    Expect(catalog.applicable('Paragraph')).toEqual([])
    Expect(catalog.global().map(entry => entry.name)).toEqual(['NewDocument'])
    Expect(catalog.entries()).toHaveLength(3)

    withdraw()
    Expect(catalog.global()).toEqual([])
    Expect(catalog.entries()).toHaveLength(2)
  })

  Test('resolves a catalogued command back to the value that runs it', () => {
    const catalog = new CommandCatalog()
    let invoked = 0
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(() => {
          invoked += 1
        }),
      members: { Title: () => TR.Value('Finish document') },
      name: 'Finish',
      slots: ['Document'],
    })
    catalog.register({
      commands: [{
        command: () => command,
        identity: '@ui/Documents.Finish',
        name: 'Finish',
        scope: { kind: 'module' },
        slots: [{ entity: true, name: 'Document', required: true, type: 'Document' }],
        static: {},
      }],
      module: '@ui/Documents',
    })

    const entry = catalog.applicable('Document')[0]
    Expect(entry?.identity).toBe('@ui/Documents.Finish')
    const bound = entry?.command().with({ Document: TR.Value('draft') })
    Expect(bound?.read().label).toBe('Finish document')
    bound?.evaluate().jsValue.invoke()
    Expect(invoked).toBe(1)
  })
})
