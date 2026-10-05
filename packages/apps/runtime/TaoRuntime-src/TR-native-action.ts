import { runAction } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import type { TaoActionOwner } from './TR-native-subscription'

/** Native callback records promise invocation; runtime actions additionally preserve owned policy. */
type NativeAction<Args extends unknown[]> = {
  invoke(...args: Args): void | Promise<void>
  invokeOwned?(owner: TaoActionOwner, active: () => boolean, ...args: Args): void | Promise<void>
}

/** Existing private event wrappers carry only the owned entry point and keep that policy. */
export type NativeActionInput<Args extends unknown[]> = NativeAction<Args> | {
  invokeOwned(owner: TaoActionOwner, active: () => boolean, ...args: Args): void | Promise<void>
}

/** Structural callbacks enter the same owned root queue without borrowing ambient transactions. */
export function invokeNativeAction<Args extends unknown[]>(
  action: NativeActionInput<Args>,
  owner: TaoActionOwner,
  active: () => boolean,
  ...args: Args
): void | Promise<void> {
  if (action.invokeOwned !== undefined) {
    return action.invokeOwned(owner, active, ...args)
  }
  RuntimeAssert('invoke' in action, 'a structural native callback promises invocation')
  return runAction(
    'native callback',
    args,
    () => owner.active && active() ? action.invoke(...args) : undefined,
    false,
    false,
    undefined,
    undefined,
    owner,
  )
}
