import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import { SignInFlow } from '../@tao/auth/AuthFlow'
import { TestAuthProvider } from '../@tao/auth/testing/TestAuth'

Describe('@tao/auth headless sign-in flow', () => {
  Test('keeps challenge failures editable, completes a valid code, and clears sensitive fields', async () => {
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(TR.Auth.Declaration('TestAuth', TestAuthProvider()), {}))
    await scope.restore()
    const flow = SignInFlow(scope, 'EmailCode')
    flow.writeMember(['Email'], 'alice@example.com')
    await flow.SendCode.invoke()
    Expect(flow.Step).toBe('Code')
    flow.writeMember(['Code'], 'wrong')
    await flow.Verify.invoke()
    Expect(flow.Step).toBe('Code')
    Expect(flow.Problem).toBe('The code was not accepted. Try again.')
    flow.writeMember(['Code'], '123456')
    await flow.Verify.invoke()
    Expect(flow.Step).toBe('Completed')
    Expect(scope.session.identity?.accountId).toBe('test-account')
    Expect(flow.Code).toBe('')
    Expect(Object.keys(flow)).not.toContain('Code')
    Expect(Object.keys(flow)).not.toContain('Password')
    await flow.Cancel.invoke()
    scope.dispose()
  })

  Test('a cancelled pending operation cannot overwrite the retry state', async () => {
    const pending = Deferred<TR.AuthResult>()
    const provider: TR.AuthProvider = {
      connect: () => ({
        capabilities: { methods: ['Password'] },
        restore: async () => ({ state: 'SignedOut' }),
        signIn: () => pending.promise,
        signOut: async () => ({ status: 'completed' }),
        credential: async ({ audience }) => ({ audience, value: 'test-only' }),
      }),
    }
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(TR.Auth.Declaration('Pending', provider), {}))
    await scope.restore()
    const flow = SignInFlow(scope)
    flow.writeMember(['Password'], 'secret')
    const running = flow.Submit.invoke()
    Expect(flow.Running).toBe(true)
    await flow.Cancel.invoke()
    await flow.Reset.invoke()
    pending.resolve({ outcome: { status: 'rejected', message: 'Late failure' } })
    await running
    Expect(flow.Step).toBe('Password')
    Expect(flow.Problem).toBe('')
    Expect(flow.Password).toBe('')
    Expect(flow.Running).toBe(false)
    scope.dispose()
  })

  Test('a writable member updates the library flow without replacing its subscriptions or actions', async () => {
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(TR.Auth.Declaration('TestAuth', TestAuthProvider()), {}))
    await scope.restore()
    const flow = SignInFlow(scope)
    const owner = TR.Cell(TR.Value(flow))
    let changes = 0
    const stop = flow.subscribe(() => {
      changes += 1
    })
    const email = TR.Member(owner, ['Email'])
    await TR.Set({ set: value => email.set!(value) }, () => TR.Value('alice@example.com'))
    Expect(owner.evaluate().jsValue).toBe(flow)
    Expect(flow.Email).toBe('alice@example.com')
    Expect(changes).toBe(1)
    stop()
    scope.dispose()
  })

  Test('a supplied flow can settle the action waiting for its sign-in presentation', async () => {
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(TR.Auth.Declaration('TestAuth', TestAuthProvider()), {}))
    await scope.restore()
    const presented = TR.Auth.SignInAction(scope).evaluate().jsValue.invoke()
    await until(() => scope.presenting)
    const flow = SignInFlow(scope)
    await flow.Submit.invoke()
    await presented
    Expect(scope.session.state).toBe('SignedIn')
    Expect(scope.presenting).toBe(false)
    scope.dispose()
  })
})
