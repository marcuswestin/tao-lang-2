/** RuntimeValue wraps a JavaScript value as an evaluable Tao runtime value. */
export class RuntimeValue<T> {
  constructor(readonly jsValue: T) {}

  evaluate(): RuntimeValue<T> {
    return this
  }
}

/** runtimeValue wraps a JavaScript value so runtime callbacks can pass Tao values to generated code. */
export function runtimeValue<T>(jsValue: T): RuntimeValue<T> {
  return new RuntimeValue(jsValue)
}
