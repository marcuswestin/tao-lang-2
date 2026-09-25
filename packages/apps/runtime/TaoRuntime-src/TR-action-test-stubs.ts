/** Each check owns a failure table; suspended actions retain it after the next check starts. */
export type TestActionStubContext = ReadonlyMap<string, string>

const empty: TestActionStubContext = new Map()
let current: TestActionStubContext = empty

export const TestActionStubs = {
  beginTest(stubs: readonly Readonly<{ actionKey: string; caseName: string }>[]): void {
    const failures = new Map<string, string>()
    for (const stub of stubs) {
      failures.set(stub.actionKey, stub.caseName)
    }
    current = failures
  },
  endTest(): void {
    current = empty
  },
  capture(): TestActionStubContext {
    return current
  },
  failureFor(context: TestActionStubContext, actionKey: string): string | undefined {
    return context.get(actionKey)
  },
} as const
