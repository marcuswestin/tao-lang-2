/** TestActionStubs holds declared failure outcomes for the one currently running Tao check. */
const failures = new Map<string, string>()

export const TestActionStubs = {
  beginTest(stubs: readonly Readonly<{ actionKey: string; caseName: string }>[]): void {
    failures.clear()
    for (const stub of stubs) {
      failures.set(stub.actionKey, stub.caseName)
    }
  },
  endTest(): void {
    failures.clear()
  },
  failureFor(actionKey: string): string | undefined {
    return failures.get(actionKey)
  },
} as const
