import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao named item failures', () => {
  Test('routes a string failure case with its Message after rollback and lexical cleanup', async () => {
    const value = TR.Cell(TR.Value('initial'))
    const events: string[] = []
    const callee = TR.Action(async () => {
      await TR.ActionScope(async () => {
        TR.Set(value, () => TR.Value('callee'))
        TR.Defer(() => events.push('cleanup'))
        events.push('body')
        await Promise.resolve()
        TR.Fail('InvalidInput', 'The value is invalid.')
      })
    }, { name: 'Validate' })
    const root = TR.Action(async () => {
      TR.Set(value, () => TR.Value('caller'))
      await TR.ThenDo(() => TR.Do(callee), {
        name: 'Validate',
        declared: ['InvalidInput'],
      }, [[
        'InvalidInput',
        payload => {
          Expect(TR.isRuntimeValue(payload)).toBe(true)
          const failure = (payload as { evaluate(): { jsValue: unknown } }).evaluate()
            .jsValue as Readonly<{ Message: string }>
          Expect(Object.isFrozen(failure)).toBe(true)
          Expect(failure.Message).toBe('The value is invalid.')
          Expect(value.evaluate().jsValue).toBe('caller')
          events.push(`handled:${failure.Message}`)
        },
      ]])
      events.push('tail')
    }, { name: 'Root' })

    await root.jsValue.invoke()

    Expect(events).toEqual(['body', 'cleanup', 'handled:The value is invalid.', 'tail'])
    Expect(value.evaluate().jsValue).toBe('caller')
  })

  Test('matches declared foreign provider names and preserves legacy enum failures', async () => {
    const foreign = TR.ForeignAction<[]>(
      () => {
        throw Object.freeze({ case: 'InvalidInput', message: 'Provider detail.' })
      },
      'Provider',
      [{ case: 'InvalidInput', sentence: 'The provider rejected this value.' }],
    )
    const legacyCases = TR.Enum(
      TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'NamedFailures', 'enum', 'LegacyFailure']),
      ['Offline'],
    )
    const legacy = TR.Action(() => TR.Fail(legacyCases['Offline']!, 'The service is offline.'), { name: 'Legacy' })
    const observed: string[] = []
    const root = TR.Action(async () => {
      await TR.ThenDo(() => TR.Do(foreign), {
        name: 'Provider',
        declared: ['InvalidInput'],
      }, [[
        'InvalidInput',
        payload =>
          observed.push(
            ((payload as { evaluate(): { jsValue: unknown } }).evaluate().jsValue as Readonly<{ Message: string }>)
              .Message,
          ),
      ]])
      await TR.ThenDo(() => TR.Do(legacy), {
        name: 'Legacy',
        declared: ['Offline'],
      }, [[
        'Offline',
        payload =>
          observed.push(
            ((payload as { evaluate(): { jsValue: unknown } }).evaluate().jsValue as Readonly<{ Message: string }>)
              .Message,
          ),
      ]])
    }, { name: 'Root' })

    await root.jsValue.invoke()

    Expect(observed).toEqual(['The provider rejected this value.', 'The service is offline.'])
  })
})
