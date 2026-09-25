import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { deferTransactionCommit } from '../TaoRuntime-src/TR-action-transactions'
import type { TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'

const definition: TaoDataSchemaDefinition = {
  name: 'OutcomeNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: { Title: { kind: 'text' } },
    },
  },
}

const ExportFailure = TR.Enum(
  TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'Outcomes', 'enum', 'ExportFailure']),
  ['Offline', 'TooLarge'],
)

const contract = { declared: ['Offline', 'TooLarge'], name: 'Export' }

function notesSchema(): { saved: string[]; schema: ReturnType<typeof TR.Data.Schema> } {
  const saved: string[] = []
  return {
    saved,
    schema: TR.Data.Schema(definition, {
      load: () => undefined,
      save: snapshot => {
        saved.push(snapshot)
      },
    }),
  }
}

function titles(schema: ReturnType<typeof TR.Data.Schema>): unknown[] {
  return schema.query({ entity: 'Note', filters: [] }).map(row => TR.Data.Read(row, 'Title'))
}

/** failingExport writes a note and then fails the way `mode` names, inside the caller's transaction. */
function failingExport(schema: ReturnType<typeof TR.Data.Schema>, mode: string): TR.Action<[]> {
  return TR.Action(async () => {
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Callee') })
    await Promise.resolve()
    if (mode === 'Offline' || mode === 'TooLarge') {
      TR.Fail(ExportFailure[mode]!, `${mode} sentence.`)
    }
    if (mode === 'throw') {
      TR.Errors.failHost('The disk went away.')
    }
  }, { name: 'Export' })
}

/** runOutcome invokes `callee` from a root that writes first, and records the outcome that ran. */
async function runOutcome(
  callee: (schema: ReturnType<typeof TR.Data.Schema>) => TR.Action<[]>,
  outcomeNames: readonly string[],
): Promise<{ ran: string[]; reports: unknown[]; schema: ReturnType<typeof TR.Data.Schema>; tail: boolean }> {
  const { schema } = notesSchema()
  const ran: string[] = []
  const reports: unknown[] = []
  let tail = false
  const stop = TR.Errors.onFailure(report => reports.push(report))
  const root = TR.Action(async () => {
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Caller') })
    await TR.WhenDo(
      () => TR.Do(callee(schema)),
      contract,
      outcomeNames.map(name => [name, message => ran.push(`${name}: ${message.evaluate().jsValue}`)] as const),
    )
    tail = true
  }, { name: 'Root' })
  await root.jsValue.invoke()
  await TR.Data.Settle(schema)
  stop()
  return { ran, reports, schema, tail }
}

Describe('Tao effect outcomes', () => {
  Test('runs saved after the verb finishes and keeps its writes', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema => failingExport(schema, 'none'),
      ['saved', 'rejected', 'error'],
    )
    Expect(ran).toEqual(['saved: '])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller', 'Callee'])
    Expect(reports).toEqual([])
  })

  Test('rolls back the verb while the caller keeps its earlier write, and runs the named case', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema => failingExport(schema, 'Offline'),
      ['saved', 'Offline', 'rejected'],
    )
    Expect(ran).toEqual(['Offline: Offline sentence.'])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller'])
    Expect(reports).toEqual([])
  })

  Test('lets rejected catch a declared case the site does not name, with its sentence', async () => {
    const { ran, schema } = await runOutcome(schema => failingExport(schema, 'TooLarge'), ['Offline', 'rejected'])
    Expect(ran).toEqual(['rejected: TooLarge sentence.'])
    Expect(titles(schema)).toEqual(['Caller'])
  })

  Test('routes a failure the verb never declared to error, and never to rejected', async () => {
    const { ran } = await runOutcome(schema => failingExport(schema, 'throw'), ['rejected', 'error'])
    Expect(ran).toEqual(['error: The disk went away.'])
  })

  Test('propagates an unhandled failure exactly as a plain do failure', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema => failingExport(schema, 'TooLarge'),
      ['saved', 'Offline', 'error'],
    )
    Expect(ran).toEqual([])
    Expect(tail).toBe(false)
    Expect(titles(schema)).toEqual([])
    Expect(reports).toEqual([Expect['objectContaining']({
      action: 'Root',
      case: 'TooLarge',
      frames: ['Root', 'Export'],
      message: 'TooLarge sentence.',
    })])
  })

  Test('restores a state overlay and drops a resource the verb touched first', async () => {
    const count = TR.Cell(TR.Value(0))
    const label = TR.Cell(TR.Value('before'))
    const seen: unknown[] = []
    const callee = TR.Action(() => {
      TR.Set(count, () => TR.Value(2))
      TR.Set(label, () => TR.Value('callee'))
      TR.Fail(ExportFailure['Offline']!, 'Offline sentence.')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      TR.Set(count, () => TR.Value(1))
      await TR.WhenDo(() => TR.Do(callee), contract, [[
        'rejected',
        () => seen.push(count.evaluate().jsValue, label.evaluate().jsValue),
      ]])
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(seen).toEqual([1, 'before'])
    Expect(count.evaluate().jsValue).toBe(1)
    Expect(label.evaluate().jsValue).toBe('before')
  })

  Test('drops a commit effect the rolled-back verb queued and keeps the caller one', async () => {
    const published: string[] = []
    const callee = TR.Action(() => {
      deferTransactionCommit(() => published.push('callee'))
      TR.Fail(ExportFailure['Offline']!, 'Offline sentence.')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      deferTransactionCommit(() => published.push('caller'))
      await TR.WhenDo(() => TR.Do(callee), contract, [['rejected', () => undefined]])
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(published).toEqual(['caller'])
  })

  Test('falls back to a message naming the verb when nothing says more', async () => {
    const seen: unknown[] = []
    const callee = TR.Action(() => {
      TR.Fail(ExportFailure['Offline']!, '')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(callee), contract, [[
        'Offline',
        message => seen.push(message.evaluate().jsValue),
      ]])
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(seen).toEqual(["Couldn't finish 'Export.' Nothing was changed."])
  })
})
