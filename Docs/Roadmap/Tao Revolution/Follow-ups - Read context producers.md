# Read context producers

Deferred work requested on 2026-10-03: begin after the staged-release QA project is complete. The
app-scoped guard slice exposes one ReadContext contract now; optional fields stay `none` until a
producer can supply trustworthy evidence. Runtime code marks any unimplemented field explicitly.

## Producer work

1. Measure loading duration from the actual read lifecycle, including refreshes that have no cached
   content. Keep `ElapsedSeconds` monotonic and reset it when the read settles; do not turn cached
   refreshes into loading failures.
2. Add progress only for providers with measured completed and total work. Unknown progress stays
   `none`; never synthesize a percentage or completion estimate.
3. Preserve confirmed missing causes (row not found versus unresolved reference) and auth causes
   (signed out versus denied read policy) without exposing protected entity existence or identifiers.
4. Classify errors at their source into safe public categories. Keep raw provider details in
   diagnostics, outside `Context.Message`; prove that sentinel credentials/internal messages cannot
   reach either local guard rendering or the runtime/app net.
5. Implement `Retryable` and `Retry` only where repeating the read is safe, scoped to the correct
   subject/provider and preserves stale content. Add cancellation/deduplication behavior and a real
   callable action; `none` remains the default elsewhere. Prove optional callable invocation in Tao:
   the current validator does not narrow `action() | none` after an `if … != none` check. Resolve that
   language contract with the Developer before enabling these producers.
6. Implement `Recovery` for a known auth or access path. A generic access failure must not guess a
   sign-in flow or promise that requesting access will succeed.

## Acceptance

Each implemented producer has focused source and runtime proof, one Tao journey where behavior is
observable, and truthful default rendering in a no-override app. Optional callable members need a
validated invocation path that excludes `none`; the fields are exposed as stubs today. Preserve per-case app/variant inheritance, site
precedence, and the four exceptional states. Refresh Spec and WordFlower Next first for any changed
contract; remove only the corresponding stub marker when its producer is proved.
