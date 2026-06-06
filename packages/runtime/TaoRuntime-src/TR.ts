class RuntimeValue<T> {
  constructor(readonly jsValue: T) {}

  evaluate(): TR.Value<T> {
    return this
  }
}

class RuntimeAlias<T> {
  constructor(private readonly value: TR.Value<T>) {}

  evaluate(): TR.Value<T> {
    return this.value.evaluate()
  }
}

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static readonly Value = RuntimeValue

  /** Alias creates runtime Tao aliases from Tao values. */
  static Alias<T>(value: TR.Value<T>): TR.Alias<T> {
    return new RuntimeAlias(value)
  }

  /** BlockScope creates a child scope that can shadow parent declarations. */
  static BlockScope<ScopeT extends TR.Scope, ReturnT>(parentScope: ScopeT, body: (scope: ScopeT) => ReturnT): ReturnT {
    const scope = Object.create(parentScope) as ScopeT
    return body(scope)
  }
}

namespace TR {
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T>
  /** Scope declares generated Tao runtime declaration storage. */
  export type Scope = Record<string, any>
}

export default TR
