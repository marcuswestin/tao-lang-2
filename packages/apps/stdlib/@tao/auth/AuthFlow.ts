import TR from '@runtime/TR'
import { createReactiveSource } from '@runtime/TR-reactive'

/** A sign-in flow owns transient inputs and can be held by one mounted Tao state value. */
export function SignInFlow(scope: TR.AuthScope, method = 'Password') {
  const changes = createReactiveSource()
  let step = method === 'EmailCode' ? 'Email' : 'Password'
  let email = ''
  let password = ''
  let code = ''
  let problem = ''
  let running = false
  let challengeId: string | undefined
  let retryAt = 0
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let registration = false
  function changed() {
    changes.notify()
  }
  function clearSensitive() {
    password = ''
    code = ''
  }
  async function submit(resend = false): Promise<void> {
    if (running || (resend && Date.now() < retryAt)) {
      return
    }
    const current = ++generation
    running = true
    problem = ''
    changed()
    const outcome = await scope.signIn({
      method,
      ...(!resend && challengeId ? { challengeId } : {}),
      fields: { Email: email, Password: password, Code: code, Register: String(registration) },
    })
    if (current !== generation) {
      return
    }
    running = false
    if (outcome.status === 'rejected' || outcome.status === 'error') {
      problem = outcome.message ?? 'Unable to sign in. Please try again.'
    } else if (outcome.status === 'cancelled') {
      step = 'Cancelled'
      clearSensitive()
    } else if (scope.session.state === 'SignedIn') {
      step = 'Completed'
      if (timer) {
        clearTimeout(timer)
      }
      clearSensitive()
    } else if (scope.session.challenge) {
      challengeId = scope.session.challenge.id
      step = scope.session.challenge.kind === 'EmailCode' ? 'Code' : scope.session.challenge.kind
      code = ''
      retryAt = Date.now() + 30_000
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(changed, 30_000)
    }
    changed()
  }
  const flow = {
    get Step() {
      return step
    },
    get Email() {
      return email
    },
    get Password() {
      return password
    },
    get Code() {
      return code
    },
    get Registration() {
      return registration
    },
    get Running() {
      return running
    },
    get Problem() {
      return problem
    },
    get RetryAfter() {
      return Math.max(0, retryAt - Date.now()) * 1_000_000
    },
    writeMember(path: readonly string[], value: unknown) {
      if (path.length !== 1) {
        return
      }
      if (path[0] === 'Email') {
        email = String(value)
      }
      if (path[0] === 'Password') {
        password = String(value)
      }
      if (path[0] === 'Code') {
        code = String(value)
      }
      if (path[0] === 'Registration') {
        registration = value === true
      }
      changed()
    },
    SendCode: TR.Action(() => submit(), { interrupt: true }).evaluate().jsValue,
    Verify: TR.Action(() => submit(), { interrupt: true }).evaluate().jsValue,
    Resend: TR.Action(() => submit(true), { interrupt: true }).evaluate().jsValue,
    Submit: TR.Action(() => submit(), { interrupt: true }).evaluate().jsValue,
    Cancel: TR.Action(() => {
      generation += 1
      scope.cancel()
      running = false
      step = 'Cancelled'
      clearSensitive()
      if (timer) {
        clearTimeout(timer)
      }
      changed()
    }, { interrupt: true }).evaluate().jsValue,
    Reset: TR.Action(() => {
      generation += 1
      scope.cancel()
      running = false
      step = method === 'EmailCode' ? 'Email' : 'Password'
      problem = ''
      challengeId = undefined
      retryAt = 0
      clearSensitive()
      if (timer) {
        clearTimeout(timer)
      }
      changed()
    }, { interrupt: true }).evaluate().jsValue,
    subscribe: changes.subscribe,
  }
  for (const key of ['Password', 'Code']) {
    Object.defineProperty(flow, key, { ...Object.getOwnPropertyDescriptor(flow, key), enumerable: false })
  }
  return TR.ReactiveValue(flow)
}

export type AuthFlow = ReturnType<typeof SignInFlow>

/** The public Tao flow shape; native-only reactive hooks are checked at the supplied UI boundary. */
export type LoginFlowValue =
  & Pick<AuthFlow, 'Step' | 'Email' | 'Password' | 'Code' | 'Registration' | 'Running' | 'Problem' | 'RetryAfter'>
  & {
    [Action in 'SendCode' | 'Verify' | 'Resend' | 'Submit' | 'Cancel' | 'Reset']: { invoke(): void | Promise<void> }
  }
