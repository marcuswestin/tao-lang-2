/**
 * Evaluable is one runtime value. Evaluating it yields a value that both carries `jsValue` and
 * evaluates to itself, because generated code evaluates a value where it reads it and hands the
 * result to a runtime call that evaluates it again.
 */
export type Evaluable = {
  evaluate(): Evaluable & { jsValue: unknown }
}

/** TaoEvaluable is the runtime wrapper generated code passes into runtime-owned actions. */
export type TaoEvaluable<ValueT> = {
  evaluate(): { jsValue: ValueT }
}

/** TaoActionValue is the invokable payload held by an action-valued Tao member. */
export type TaoActionValue<Args extends any[] = any[]> = {
  invoke(...args: Args): void | Promise<void>
  nativeEventActive?(): boolean
  invokeNativeEvent?(...args: Args): void | Promise<void>
}

/** TaoActionFactory turns a runtime action body into the value generated `do` statements invoke. */
export type TaoActionFactory = <Args extends any[]>(
  body: (...args: Args) => unknown,
) => TaoActionValue<Args>
