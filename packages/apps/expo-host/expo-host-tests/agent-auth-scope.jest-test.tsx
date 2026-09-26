import TR from '@runtime/TR'
import { Deferred, Describe, Expect, settle, Test, until } from '@shared/test'
import { act, render } from '@testing-library/react-native'

const commandId = 'tests/@workspace/Commands/command/Append'

Describe('mounted app command auth scope', () => {
  Test('rejects a queued request admitted before its mounted account signs out', async () => {
    const gate = Deferred<void>()
    const scope = accountScope('alice')
    await scope.restore()
    let invocations = 0
    const command = TR.Interaction.Command({
      name: 'Append',
      action: () =>
        TR.Action(async () => {
          invocations += 1
          await gate.promise
        }),
    })
    const unregister = TR.Interaction.RegisterCommands({
      module: 'tests/@workspace/Commands',
      commands: [{
        command: () => command,
        identity: commandId,
        name: 'Append',
        scope: { kind: 'module' },
        slots: [],
        static: { title: 'Append' },
      }],
    })
    function MountedApp(): null {
      TR.Agent.useCommands([command], [], scope)
      return null
    }
    const screen = render(TR.createElement(MountedApp))
    const first = TR.Agent.run(commandId).catch(error => error)
    const queued = TR.Agent.run(commandId).catch(error => error)
    try {
      await until(() => invocations === 1, { description: 'the first command to start' })
      await scope.signOut()
      gate.resolve()
      Expect(await first).toMatchObject({ outcome: 'committed' })
      Expect(await queued).toMatchObject({ message: 'The signed-in account changed before the command ran.' })
      Expect(invocations).toBe(1)
    } finally {
      gate.resolve()
      await Promise.allSettled([first, queued])
      screen.unmount()
      unregister()
      scope.dispose()
    }
  })

  Test('retains queued commands across rerenders and persists only the selected mounted store', async () => {
    const save = Deferred<void>()
    const saves: Array<{ account: string; snapshot: string }> = []
    const seenScopes: Array<TR.AuthScope | undefined> = []
    const schema = TR.Data.Schema({
      name: 'AgentAccountNotes',
      entities: {
        Account: { collection: 'Accounts', fields: { DisplayName: { kind: 'text' } } },
        Note: {
          collection: 'Notes',
          fields: { Body: { kind: 'text' }, Owner: { kind: 'relation', relation: 'Account' } },
          grants: [{ operations: ['read', 'create'], principal: ['Owner'] }],
        },
      },
    })
    const source = TR.Data.Configure(
      TR.Data.Declaration('ScopedNotes', {
        authenticatedAuthority: 'server',
        connect: context => ({
          load: () =>
            JSON.stringify({
              formatVersion: 1,
              schemaVersion: 1,
              nextId: 1,
              rows: { Account: [{ Id: context.auth!.accountId, DisplayName: context.auth!.accountId }], Note: [] },
            }),
          save: snapshot => {
            saves.push({ account: context.auth!.accountId, snapshot })
            return save.promise
          },
        }),
      }),
      {},
    )
    const alice = accountScope('alice')
    const bob = accountScope('bob')
    const append = TR.Interaction.Command({
      name: 'Append',
      slots: ['Body'],
      action: fills => {
        const scope = fills['__taoAuth']?.evaluate().jsValue as TR.AuthScope | undefined
        return TR.Action(() => {
          seenScopes.push(scope)
          TR.Data.Create(TR.Auth.Store(scope, schema), 'Note', {
            Body: fills['Body']!,
            Owner: TR.Auth.Account(scope!, schema, 'Account'),
          })
        })
      },
    })
    const unregister = TR.Interaction.RegisterCommands({
      module: 'tests/@workspace/Commands',
      commands: [{
        command: () => append,
        identity: commandId,
        name: 'Append',
        scope: { kind: 'module' },
        slots: [{ entity: false, name: 'Body', required: true, scalarType: 'text', type: 'text' }],
        static: { title: 'Append note' },
      }],
    })
    function MountedApp({ scope }: { scope: TR.AuthScope }): null {
      TR.Auth.UseDatasources(scope, [{ store: schema, source }])
      // Generated getters return new arrays containing stable declaration objects on every render.
      TR.Agent.useCommands([append], [schema], scope)
      return null
    }
    await Promise.all([alice.restore(), bob.restore()])
    const screen = render(TR.createElement(MountedApp, { scope: alice }))
    let first: ReturnType<typeof TR.Agent.run> | undefined
    let queued: Promise<unknown> | undefined
    try {
      await TR.Agent.ready()
      Expect(TR.Agent.commands()[0]).toMatchObject({ id: commandId, name: 'Append' })
      let completed = false
      first = TR.Agent.run(commandId, { Body: 'First' }).then(result => {
        completed = true
        return result
      })
      queued = TR.Agent.run(commandId, { Body: 'Queued' }).catch(error => error)
      await until(() => seenScopes.length >= 1, { description: 'the mounted command invocation' })
      Expect(seenScopes[0] === alice).toBe(true)
      await until(() => saves.length === 1, { description: 'the mounted command provider save' })
      await settle()
      Expect(completed).toBe(false)
      Expect(schema.query({ entity: 'Note', filters: [] })).toEqual([])
      Expect(bob.store(schema).query({ entity: 'Note', filters: [] })).toEqual([])

      await act(async () => {
        screen.rerender(TR.createElement(MountedApp, { scope: alice }))
      })
      save.resolve()
      Expect(await first).toMatchObject({ outcome: 'committed' })
      Expect(await queued).toMatchObject({ outcome: 'committed' })
      Expect(seenScopes.map(scope => scope?.session.identity?.accountId)).toEqual(['alice', 'alice'])
      Expect(saves.map(saved => saved.account)).toEqual(['alice', 'alice'])
      Expect(JSON.parse(saves[1]!.snapshot).rows.Note.map((row: { Body: string }) => row.Body))
        .toEqual(['First', 'Queued'])

      await act(async () => {
        screen.rerender(TR.createElement(MountedApp, { scope: bob }))
      })
      Expect(await TR.Agent.run(commandId, { Body: 'Bob only' })).toMatchObject({ outcome: 'committed' })
      Expect(seenScopes.map(scope => scope?.session.identity?.accountId)).toEqual(['alice', 'alice', 'bob'])
      Expect(saves.map(saved => saved.account)).toEqual(['alice', 'alice', 'bob'])
      Expect(JSON.parse(saves[2]!.snapshot).rows.Note.map((row: { Body: string }) => row.Body))
        .toEqual(['Bob only'])
      Expect(alice.store(schema).query({ entity: 'Note', filters: [] })).toHaveLength(2)
      Expect(schema.query({ entity: 'Note', filters: [] })).toEqual([])
    } finally {
      save.resolve()
      await Promise.allSettled([first, queued])
      screen.unmount()
      unregister()
      alice.dispose()
      bob.dispose()
    }
  })
})

function accountScope(accountId: string): TR.AuthScope {
  return TR.Auth.CreateScope(TR.Auth.Configure(
    TR.Auth.Declaration('Deterministic', {
      connect: () => ({
        capabilities: { methods: [] },
        restore: async () => ({ state: 'SignedIn', identity: { accountId, issuer: 'test', subject: accountId } }),
        signIn: async () => ({ outcome: { status: 'cancelled' } }),
        signOut: async () => ({ status: 'completed' }),
        credential: async request => ({ audience: request.audience, value: 'test-credential' }),
      }),
    }),
    {},
  ))
}
