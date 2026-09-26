import TR from '@runtime/TR'
import { createElement } from 'react'
import { AuthPresentation } from './AuthViews'

/** Session is compiler-bound with the declaration-owned enum cases. */
export function Session(scope: TR.AuthScope, cases: Readonly<Record<string, TR.Evaluable>>): TR.Evaluable {
  return TR.Auth.Session(scope, cases)
}

/** SignIn presents the same flow used by the embedded sign-in view. */
export function SignIn(scope: TR.AuthScope): TR.Action<[]> {
  return TR.Auth.SignInAction(scope, current => createElement(AuthPresentation, { scope: current }))
}

export function SignOut(scope: TR.AuthScope): TR.Action<[]> {
  return TR.Auth.SignOutAction(scope)
}
