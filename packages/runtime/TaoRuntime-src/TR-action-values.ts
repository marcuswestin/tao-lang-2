/** TaoEvaluable is the runtime wrapper generated code passes into runtime-owned actions. */
export type TaoEvaluable<ValueT> = {
  evaluate(): { jsValue: ValueT }
}

/** TaoActionValue is the invokable payload held by an action-valued Tao member. */
export type TaoActionValue<Args extends any[] = any[]> = {
  invoke(...args: Args): void | Promise<void>
}

/** TaoActionFactory turns a runtime action body into the value generated `do` statements invoke. */
export type TaoActionFactory = <Args extends any[]>(
  body: (...args: Args) => unknown,
) => TaoActionValue<Args>
