import { Describe, Expect, Test } from '@shared/test'
import { createShareSheet } from '../TaoRuntime-src/TR-share'

type ActionValue<Args extends any[] = any[]> = { invoke(...args: Args): void | Promise<void> }

const value = (jsValue: string) => ({ evaluate: () => ({ jsValue }) })

Describe('TR Share', () => {
  Test('loads React Native lazily and opens the share sheet with evaluated text', async () => {
    let loads = 0
    const messages: string[] = []
    const native = {
      required<ModuleT>(capability: string, moduleName: 'react-native'): ModuleT {
        loads += 1
        Expect([capability, moduleName]).toEqual(['Share', 'react-native'])
        return {
          Share: {
            share: async ({ message }: { message: string }) => {
              messages.push(message)
              return { action: 'sharedAction' }
            },
          },
        } as ModuleT
      },
    }
    const sheet = createShareSheet(asAction, native)

    Expect(loads).toBe(0)

    await sheet.Open.invoke(value('First message'))
    await sheet.Open.invoke(value('Second message'))
    Expect(loads).toBe(2)
    Expect(messages).toEqual(['First message', 'Second message'])
  })

  Test('reports a friendly failure when React Native has no Share module', async () => {
    const sheet = createShareSheet(asAction, {
      required<ModuleT>(): ModuleT {
        return {} as ModuleT
      },
    })

    await Expect(sheet.Open.invoke(value('Draft'))).rejects.toThrow(
      'Tao Share is unavailable because native module "react-native" does not expose Share.',
    )
  })
})

function asAction<Args extends any[]>(body: (...args: Args) => unknown): ActionValue<Args> {
  return {
    invoke: (...args) => {
      const result = body(...args)
      return isPromiseLike(result) ? Promise.resolve(result).then(() => undefined) : undefined
    },
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
}
