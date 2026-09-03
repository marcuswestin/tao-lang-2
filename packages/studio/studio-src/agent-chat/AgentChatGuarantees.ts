// Studio agent chat: which edge cases a Tao app developer does not have to test, and which they do.
//
// This is the part of the chat that could not exist for a general-purpose coding agent. A model writing tests
// for a JavaScript app defends against undefined, leaked state between tests, and clock flakiness, because
// those are real there. In Tao some of them cannot happen, and a test for one is noise that will be
// maintained forever. Others look guaranteed and are not.
//
// Every entry cites the specification section it comes from, because a wrong entry here is worse than none:
// it would teach the agent to skip a test the app actually needs. Entries were checked line by line against
// `Docs/Spec/`; where the spec marks something deferred, the entry says so rather than promising it.

export type GuaranteeVerdict =
  /** Tao makes this true, so a test asserting it tests the toolchain rather than the app. */
  | 'guaranteed'
  /** Not guaranteed. This is a real behavior of the app and worth a check. */
  | 'worth-testing'
  /** Would be worth testing, but the language cannot drive it from a test today. */
  | 'not-testable-yet'

export type Guarantee = {
  area: string
  verdict: GuaranteeVerdict
  claim: string
  /** The section this comes from, so the agent can cite it and a person can check it. */
  source: string
}

const GUARANTEES: readonly Guarantee[] = [
  {
    area: 'test isolation',
    claim:
      'Every check starts a fresh app with a fresh in-memory snapshot store and fresh navigation, and a configured snapshot-only provider cannot overwrite that isolation. Do not write tests for state leaking between checks, for test ordering, or for durable data being touched.',
    source: 'Tao Testing.md § Suites, checks, and app selection; Tao Data.md § Deterministic provider-state tests',
    verdict: 'guaranteed',
  },
  {
    area: 'test isolation',
    claim:
      'A fill-capable provider still binds in a check, and the spec puts determinism on the running app variant: a journey runs the variant whose adapter is a deterministic in-repo stub. If the app under test fills from a real adapter, its determinism is not something Tao guarantees for you.',
    source: 'Tao Data.md § Deterministic provider-state tests',
    verdict: 'worth-testing',
  },
  {
    area: 'time',
    claim:
      'The clock is held at a fixed instant and moves only with `advance`, and `(default now)` samples the held clock rather than wall-clock time. Do not write tests for timing flakiness, and do not add waits.',
    source: 'Tao Data.md § Deterministic provider-state tests; Tao Testing.md § The clock a check holds',
    verdict: 'guaranteed',
  },
  {
    area: 'time',
    claim:
      'The held clock covers what the runtime clock owns. A foreign TypeScript action with its own timer is not part of that, so anything scheduled inside one is still the app’s problem.',
    source: 'Tao Type System.md § The TypeScript boundary',
    verdict: 'worth-testing',
  },
  {
    area: 'configuration',
    claim:
      'Runtime-owned configuration checks run under test: an invalid StorageKey fails the check that mounts it rather than the first production mount. Do not write a test that asserts configuration validity.',
    source: 'Tao Data.md § Deterministic provider-state tests',
    verdict: 'guaranteed',
  },
  {
    area: 'optional values',
    claim:
      'Tao does have an absent value. `none` is part of the value core and optional item fields (`Field Type?`) are implemented, so a `text?` that was never read and one that read an empty string are different states that can render identically. Where that difference matters on screen, it is worth a check.',
    source: 'Tao Type System.md § Implemented value and control-flow contract; Tao Packages.md',
    verdict: 'worth-testing',
  },
  {
    area: 'emptiness',
    claim:
      '`Value is empty` and `.Count` are the whole emptiness story for text and lists, but not for a query. A query distinguishes loading, error and empty, and availability turns on whether a descriptor has ever filled rather than on how many rows it produced. A list screen showing the same thing while loading and while genuinely empty is a real defect, and worth a check.',
    source: 'Tao Data.md § Queries; Tao Type System.md § Implemented value and control-flow contract',
    verdict: 'worth-testing',
  },
  {
    area: 'entity guards',
    claim:
      'A `guard` on an entity handle has `loading`, `missing`, `unauthorized` and `error` branches, but a test cannot reach most of them today: driving a provider into `loading`, `error` or `ready` from a test step is retired, the world controls that replace it have not landed, and `unauthorized` is reserved for a provider that can report it. Only the `missing` branch is reachable. Do not write tests for the others and do not claim they are covered.',
    source: 'Tao Data.md § Entity availability guards; Tao Testing.md § Compiler/runtime boundary',
    verdict: 'not-testable-yet',
  },
  {
    area: 'identity',
    claim:
      'A deleted entity handle becomes `missing` while keeping its `.Id`, and application code cannot reach raw rows. Do not write tests for a handle losing its identity.',
    source: 'Tao Type System.md § Implemented value and control-flow contract',
    verdict: 'guaranteed',
  },
  {
    area: 'relaunch',
    claim:
      '`relaunch` deliberately keeps persisted state and navigation, and a journey asserting that a value survives a relaunch is a legitimate test: it fails when the round trip through storage is broken. Isolation between checks does not make this redundant.',
    source: 'Tao Testing.md § What a relaunch keeps',
    verdict: 'worth-testing',
  },
  {
    area: 'render failures',
    claim:
      'The runtime contains a render failure at the loop-item, screen and app boundaries and publishes a diagnostic artifact rather than losing the whole app. That containment is runtime behavior. It does not follow that an unguarded field access is safe: static flow narrowing and rejection of unguarded access are still deferred, so reaching a field on a handle you have not guarded is the app’s problem.',
    source: 'Tao Actions.md; Tao Type System.md § Implemented value and control-flow contract',
    verdict: 'worth-testing',
  },
]

/**
 * taoGuarantees answers "what do I not need to test here?" — and, just as importantly, refuses to let the
 * answer be "nothing to worry about". An area with nothing recorded says so rather than implying safety.
 */
export function taoGuarantees(area?: string): { guarantees: readonly Guarantee[]; note: string } {
  const term = (area ?? '').trim().toLowerCase()
  const matched = term === ''
    ? GUARANTEES
    : GUARANTEES.filter(entry =>
      entry.area.includes(term) || entry.claim.toLowerCase().includes(term) || term.includes(entry.area)
    )
  if (matched.length === 0) {
    return {
      guarantees: [],
      note:
        `Nothing is recorded about "${area}". That is not a guarantee that Tao handles it: treat it as unknown and test the behavior.`,
    }
  }
  return {
    guarantees: matched,
    note:
      'Skip a test only for an entry marked `guaranteed`, and say which one when you do. An entry marked `not-testable-yet` must not be reported as covered: the language cannot drive it from a test. Everything else is the app’s own behavior and is worth a check.',
  }
}
