import { Errors, Platform } from '@shared'
import { Expect, Test } from '@shared/test'

Test('process liveness refuses invalid PIDs without invoking its probe', () => {
  const calls: number[] = []
  for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    Expect(Platform.processIsAlive(pid, value => {
      calls.push(value)
      return true
    })).toBe(false)
  }
  Expect(calls).toEqual([])
})

Test('process liveness preserves a successful probe and treats EPERM as live', () => {
  const calls: number[] = []
  Expect(Platform.processIsAlive(1234, pid => {
    calls.push(pid)
    return true
  })).toBe(true)
  const denied = Object.assign(Errors.asError('Probe belongs to another user'), { code: 'EPERM' })
  Expect(Platform.processIsAlive(1234, () => {
    throw denied
  })).toBe(true)
  Expect(calls).toEqual([1234])
})

Test('process liveness accepts only ESRCH as evidence that a valid PID is absent', () => {
  const absent = Object.assign(Errors.asError('Probe found no process'), { code: 'ESRCH' })
  Expect(Platform.processIsAlive(1234, () => {
    throw absent
  })).toBe(false)
})

for (const code of ['EIO', 'EINVAL', undefined] as const) {
  Test(`process liveness retains the original ${code ?? 'uncoded'} probe failure as host uncertainty`, () => {
    const original = Object.assign(
      Errors.asError('Injected liveness probe failure'),
      code === undefined ? {} : { code },
    )
    let caught: unknown
    try {
      Platform.processIsAlive(1234, () => {
        throw original
      })
    } catch (error) {
      caught = error
    }
    Expect(caught).toBeInstanceOf(Errors.HostEnvironmentError)
    const typed = caught as Errors.HostEnvironmentError
    Expect(typed.cause).toBe(original)
    Expect(typed.details?.['pid']).toBe(1234)
    Expect(typed.details?.['code']).toBe(code)
    Expect(Errors.formatForUser(typed)).toBe('Could not determine whether the process is alive.')
  })
}

Test('process liveness wraps a non-error uncoded probe failure without losing its cause', () => {
  let caught: unknown
  try {
    Platform.processIsAlive(1234, () => {
      throw undefined
    })
  } catch (error) {
    caught = error
  }
  Expect(caught).toBeInstanceOf(Errors.HostEnvironmentError)
  Expect((caught as Errors.HostEnvironmentError).cause).toBe(undefined)
})
