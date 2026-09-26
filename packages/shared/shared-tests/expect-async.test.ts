import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import { CLI, Errors, Time } from '../shared-src/shared'

Describe('Expect asynchronous matchers', () => {
  Test('returns control before a pending assertion settles', async () => {
    const pending = Deferred<number>()
    let timerRan = false
    // The timer is an escape hatch for the broken synchronous matcher, not a speed assertion.
    const timer = setTimeout(() => {
      timerRan = true
      pending.resolve(7)
    }, 20)
    try {
      const assertion = Expect(pending.promise).resolves.toBe(7)
      Expect(timerRan).toBe(false)
      pending.resolve(7)
      await assertion
    } finally {
      clearTimeout(timer)
      pending.resolve(7)
    }
  })
})

Test('settles every Git child when an assertion starts in a child completion', async () => {
  for (let batch = 0; batch < 20; batch++) {
    let completed = 0
    const children = Array.from(
      { length: 34 },
      () =>
        CLI.run('git', { args: ['--version'], stdio: 'pipe' }).then(result => {
          completed++
          Expect(result.exitCode).toBe(0)
          Expect(result.stdout).toContain('git version')
        }),
    )
    const assertion = children[0]!.then(async () => {
      await Expect(Time.sleep(20)).resolves.toBeUndefined()
    })
    await until(() => completed === children.length, { description: `all Git children in batch ${batch} to close` })
    await Promise.all([...children, assertion])
  }
})

Describe('Expect promise matcher semantics', () => {
  Test('preserves negation on either side of the promise modifier', async () => {
    await Expect(Promise.resolve(7)).resolves.not.toBe(8)
    await Expect(Promise.resolve(7)).not.resolves.toBe(8)
    await Expect(Promise.reject('failure')).rejects.not.toBe('other')
    await Expect(Promise.reject('failure')).not.rejects.toBe('other')
  })

  Test('preserves rejection toThrow and wrong-direction assertion failures', async () => {
    const reason = new Errors.UnexpectedBehaviorError('expected rejection')
    await Expect(Promise.reject(reason)).rejects.toThrow('expected rejection')
    await Expect(Expect(Promise.resolve(7)).resolves.toBe(8)).rejects.toThrow()
    await Expect(Expect(Promise.reject(reason)).resolves.toBe(7)).rejects.toThrow()
    await Expect(Expect(Promise.resolve(7)).rejects.toBe(7)).rejects.toThrow()
    await Expect(Expect(Promise.resolve(7)).resolves.not.toBe(7)).rejects.toThrow()
  })

  Test('does not convert a non-promise into valid promise-matcher input', async () => {
    const assertion = Promise.resolve().then(() => Expect(7).resolves.toBe(7))
    await Expect(assertion).rejects.toThrow()
  })

  Test('does not consume a thenable rejected by the native Bun matcher', async () => {
    let calls = 0
    const thenable = {
      then(resolve: (value: number) => void) {
        resolve(++calls)
      },
    }
    const assertion = Promise.resolve().then(() => Expect(thenable).resolves.toBe(1))
    await Expect(assertion).rejects.toThrow()
    Expect(calls).toBe(0)
  })

  Test('the unguarded escape hatch still waits asynchronously', async () => {
    const pending = Deferred<number>()
    let timerRan = false
    const timer = setTimeout(() => {
      timerRan = true
      pending.resolve(7)
    }, 20)
    try {
      const assertion = Expect.Unguarded(pending.promise).resolves.toBe(7)
      Expect(timerRan).toBe(false)
      pending.resolve(7)
      await assertion
    } finally {
      clearTimeout(timer)
      pending.resolve(7)
    }
  })

  Test('guards a Langium-shaped value hidden in a settled promise', async () => {
    const node = { $type: 'Member', $cstNode: { text: 'member' } }
    await Expect(Expect(Promise.resolve(node)).resolves.toEqual({}))
      .rejects.toThrow('refuses a Langium AST node')
    await Expect(Expect(Promise.reject(node)).rejects.toEqual({}))
      .rejects.toThrow('refuses a Langium AST node')
    await Expect.Unguarded(Promise.resolve(node)).resolves.toEqual(node)
  })
})
