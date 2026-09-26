/** Isolated OS adapter probe; a mocked scheduling operation must not affect other tests. */
import { Errors, HCI, Platform } from '@shared'
import { MockModule } from '@shared/test'
import * as OS from 'node:os'

const originalOS = { ...OS }
let priority = Number(Platform.runtimeProcess.argv[2])
const refused = Platform.runtimeProcess.argv[3] === 'refused'
const writes: number[] = []
MockModule('node:os', () => ({
  ...originalOS,
  getPriority: () => priority,
  setPriority(value: number) {
    writes.push(value)
    if (refused) {
      Errors.throwHostEnvironment('priority fixture refusal')
    }
    priority = value
  },
}))
let failure: string | undefined
try {
  Platform.lowerProcessPriority()
  Platform.lowerProcessPriority()
} catch (error) {
  failure = Errors.formatForUser(error)
}
HCI.writeLine(JSON.stringify({ failure, priority, writes }))
