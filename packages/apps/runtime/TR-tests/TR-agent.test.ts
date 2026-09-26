import TR from '@runtime/TR'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { beginActionLaunch } from '../TaoRuntime-src/TR-action-transactions'
import type { TaoDataConnection } from '../TaoRuntime-src/TR-data'
import { HostEnvironmentError, TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import type { TaoCommandSlotDescription } from '../TaoRuntime-src/TR-interaction-catalog'

const identity = 'tests/@workspace/Commands/command/Append'

function expose(
  command: TR.Command,
  slots: readonly TaoCommandSlotDescription[] = [],
  stores: readonly TR.DataSchema[] = [],
): () => void {
  const unregister = TR.Interaction.RegisterCommands({
    commands: [{
      command: () => command,
      identity,
      name: command.name,
      scope: { kind: 'module' },
      slots,
      static: { title: 'Append note' },
    }],
    module: 'tests/@workspace/Commands',
  })
  const unconfigure = TR.Agent.configure([command], stores)
  return () => {
    unconfigure()
    unregister()
  }
}

function schema(connection: TaoDataConnection): TR.DataSchema {
  return TR.Data.Schema({
    entities: { Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } } },
    name: 'AgentNotes',
  }, connection)
}

Describe('installed app command runtime', () => {
  Test('waits for selected provider loading and rejects a failed load without running', async () => {
    const load = Deferred<string | undefined>()
    const store = schema({ load: () => load.promise, save: () => undefined })
    let invoked = false
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(() => {
          invoked = true
        }),
      name: 'Append',
    })
    const cleanup = expose(command, [], [store])
    let ready = false
    try {
      const pending = TR.Agent.ready().then(() => {
        ready = true
      }, error => error)
      const running = TR.Agent.run(identity).catch(error => error)
      await settle()
      Expect(ready).toBe(false)
      Expect(invoked).toBe(false)
      load.reject(new HostEnvironmentError('Provider unavailable'))
      Expect(await pending).toMatchObject({ message: 'Could not load data: Provider unavailable' })
      Expect(await running).toMatchObject({ message: 'Could not load data: Provider unavailable' })
      Expect(invoked).toBe(false)
    } finally {
      cleanup()
    }
  })

  Test('discovers only the allowlist and strictly binds scalar arguments while retaining defaults', async () => {
    const seen: unknown[][] = []
    const command = TR.Interaction.Command({
      action: fills =>
        TR.Action(() => {
          seen.push(['Text', 'Count', 'Flag'].map(name => fills[name]?.evaluate().jsValue ?? 4))
        }),
      name: 'Append',
      slots: ['Text', 'Count', 'Flag'],
    })
    const cleanup = expose(command, [
      { entity: false, name: 'Text', required: true, scalarType: 'text', type: 'Append.Text' },
      { entity: false, name: 'Count', required: false, scalarType: 'number', type: 'Append.Count' },
      { entity: false, name: 'Flag', required: true, scalarType: 'boolean', type: 'Append.Flag' },
    ])
    try {
      Expect(TR.Agent.commands()).toEqual([{
        id: identity,
        name: 'Append',
        title: 'Append note',
        parameters: [
          { name: 'Text', required: true, type: 'text' },
          { name: 'Count', required: false, type: 'number' },
          { name: 'Flag', required: true, type: 'boolean' },
        ],
      }])
      await Expect(TR.Agent.run(identity, { Text: 'draft', Flag: false })).resolves.toEqual({
        commandId: identity,
        outcome: 'committed',
      })
      await TR.Agent.run(identity, { Text: '', Count: 0, Flag: true })
      await Expect(TR.Agent.run(identity, { Text: 'draft', Flag: 'false' })).rejects.toThrow('must be boolean')
      await Expect(TR.Agent.run(identity, { Text: 'draft', Flag: false, Count: '4' })).rejects.toThrow('must be number')
      await Expect(TR.Agent.run(identity, { Text: 'draft', Flag: false, Count: NaN })).rejects.toThrow('must be number')
      await Expect(TR.Agent.run(identity, { Text: 'draft', Flag: false, Extra: true })).rejects.toThrow(
        'has no parameter',
      )
      await Expect(TR.Agent.run(identity, { Text: 'draft' })).rejects.toThrow('requires parameter')
      await Expect(TR.Agent.run(identity, [])).rejects.toThrow('JSON object')
      await Expect(TR.Agent.run('private', {})).rejects.toThrow('not exposed')
      Expect(seen).toEqual([['draft', 4, false], ['', 0, true]])
    } finally {
      cleanup()
    }
  })

  Test('re-evaluates Enabled after binding arguments without invoking disabled actions', async () => {
    let enabled = false
    let invoked = 0
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(() => {
          invoked += 1
        }),
      members: { Enabled: () => TR.Value(enabled) },
      name: 'Append',
    })
    const cleanup = expose(command)
    try {
      Expect(TR.Agent.commands()[0]?.enabled).toBe(false)
      await Expect(TR.Agent.run(identity)).rejects.toThrow('disabled')
      enabled = true
      Expect(TR.Agent.commands()[0]?.enabled).toBe(true)
      await TR.Agent.run(identity)
      enabled = false
      await Expect(TR.Agent.run(identity)).rejects.toThrow('disabled')
      Expect(invoked).toBe(1)
    } finally {
      cleanup()
    }
  })

  Test('returns the exact swallowed root failure and rolls back its writes', async () => {
    const saved: string[] = []
    const store = schema({
      load: () => undefined,
      save: value => {
        saved.push(value)
      },
    })
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(async () => {
          TR.Data.Create(store, 'Note', { Title: TR.Value('Must roll back') })
          await Promise.resolve()
          throw new TaoActionFailure('Rejected', 'The note was rejected.')
        }, { name: 'AppendNote' }),
      name: 'Append',
    })
    const cleanup = expose(command, [], [store])
    try {
      const result = await TR.Agent.run(identity)
      Expect(result.outcome).toBe('failed')
      Expect(result.failure).toMatchObject({
        action: 'AppendNote',
        case: 'Rejected',
        message: 'The note was rejected.',
        retryEligible: true,
      })
      Expect(store.query({ entity: 'Note', filters: [] })).toEqual([])
      Expect(saved).toEqual([])
    } finally {
      cleanup()
    }
  })

  Test('correlates the selected root receipt while another root reports a failure', async () => {
    const gate = Deferred()
    let shouldFail = false
    let started = false
    const reports: string[] = []
    const stop = TR.Errors.onFailure(failure => {
      reports.push(failure.case)
    })
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(async () => {
          started = true
          await gate.promise
          if (shouldFail) {
            throw new TaoActionFailure('OwnFailure', 'Selected command failed.')
          }
        }, { name: 'SelectedAction' }),
      name: 'Append',
    })
    const cleanup = expose(command)
    try {
      const pending = TR.Agent.run(identity)
      await settle()
      Expect(started).toBe(true)
      TR.Action(() => {
        throw new TaoActionFailure('OtherFailure', 'Other root failed.')
      }, {
        interrupt: true,
        name: 'OtherAction',
      }).jsValue.invoke()
      gate.resolve()
      Expect(await pending).toEqual({ commandId: identity, outcome: 'committed' })
      shouldFail = true
      const own = await TR.Agent.run(identity)
      Expect(own.outcome).toBe('failed')
      Expect(own.failure).toMatchObject({ action: 'SelectedAction', case: 'OwnFailure' })
      Expect(reports).toEqual(['OtherFailure', 'OwnFailure'])
    } finally {
      gate.resolve()
      stop()
      cleanup()
    }
  })

  Test(
    'waits for selected provider persistence, serializes invocations, and drains without closing admission',
    async () => {
      const save = Deferred()
      const saved: string[] = []
      const store = schema({
        load: () => undefined,
        save: async value => {
          saved.push(value)
          await save.promise
        },
      })
      let invoked = 0
      const command = TR.Interaction.Command({
        action: () =>
          TR.Action(() => {
            invoked += 1
            TR.Data.Create(store, 'Note', { Title: TR.Value(`Note ${invoked}`) })
          }),
        name: 'Append',
      })
      const cleanup = expose(command, [], [store])
      let firstSettled = false
      let drained = false
      try {
        const first = TR.Agent.run(identity).then(value => {
          firstSettled = true
          return value
        })
        const second = TR.Agent.run(identity)
        const drain = TR.Agent.drain().then(() => {
          drained = true
        })
        await settle()
        Expect(invoked).toBe(1)
        Expect(saved).toHaveLength(1)
        Expect(firstSettled).toBe(false)
        Expect(drained).toBe(false)
        save.resolve()
        Expect((await first).outcome).toBe('committed')
        Expect((await second).outcome).toBe('committed')
        await drain
        await TR.Agent.run(identity)
        Expect(invoked).toBe(3)
        Expect(saved).toHaveLength(3)
        Expect(store.query({ entity: 'Note', filters: [] })).toHaveLength(3)
      } finally {
        save.resolve()
        await TR.Agent.drain()
        cleanup()
      }
    },
  )

  Test('reports a failed provider save even though its action committed in memory', async () => {
    const store = schema({
      load: () => undefined,
      save: () => {
        throw new HostEnvironmentError('Disk unavailable')
      },
    })
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(() => {
          TR.Data.Create(store, 'Note', { Title: TR.Value('Still in memory') })
        }),
      name: 'Append',
    })
    const cleanup = expose(command, [], [store])
    try {
      Expect(await TR.Agent.run(identity)).toEqual({
        commandId: identity,
        outcome: 'failed',
        persistenceErrors: [{ store: 'AgentNotes', message: 'Could not save data: Disk unavailable' }],
      })
      Expect(store.query({ entity: 'Note', filters: [] })).toHaveLength(1)
    } finally {
      cleanup()
    }
  })

  Test('reports an abandoned root across an app launch without publishing its writes', async () => {
    const wait = Deferred()
    const store = schema({ load: () => undefined, save: () => undefined })
    let started = false
    const command = TR.Interaction.Command({
      action: () =>
        TR.Action(async () => {
          started = true
          TR.Data.Create(store, 'Note', { Title: TR.Value('Abandoned') })
          await wait.promise
        }),
      name: 'Append',
    })
    const cleanup = expose(command, [], [store])
    try {
      const pending = TR.Agent.run(identity)
      await settle()
      Expect(started).toBe(true)
      beginActionLaunch()
      Expect((await pending).outcome).toBe('abandoned')
      wait.resolve()
      await settle()
      Expect(store.query({ entity: 'Note', filters: [] })).toEqual([])
    } finally {
      wait.resolve()
      await settle()
      cleanup()
    }
  })
})
