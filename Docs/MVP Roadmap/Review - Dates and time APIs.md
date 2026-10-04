# Pre-MVP review — dates and time APIs

Requested 2026-10-04. Investigation [A25](<Agent MVP Roadmap.md#a25--review-modern-date-and-time-library-designs>)
feeds decision [R20](<Developer MVP Roadmap.md#r20--dates-and-remaining-time-apis>).
Defer remaining time API decisions from the current dialogue. Investigation only: do not implement
an API or reopen selected contracts without discussing evidence with the Developer.

## Selected context

```tao
let Timer = Time.StartTimer()
do Wait(2 Seconds)
let Duration = Timer.Duration() // Fixed monotonic elapsed sample; measurement continues.
let CreatedAt = Time.Now()      // DateTime absolute instant; timezone is presentation.

// Inside a view: initialize once per mounted instance, retain across rerenders.
state Timer = Time.StartTimer()
```

Duration is signed with typed units and canonical seconds backing. Elapsed timers include device
sleep and resist wall-clock corrections; callback delivery waits until execution can resume.
Timer handles are runtime-only and nonpersistent. Persist DateTime timestamps/deadlines or captured
Duration amounts. Sampling creates no ticker. Wait is a suspending action; cancellation unwinds
cleanup, nonpositive durations add no intentional wait, long waits use bounded host timers and
fractional waits round scheduling upward. These are selected design contracts, not host acceptance.

## Investigate

1. Review current official designs/documentation for modern libraries: ECMAScript Temporal,
   Java java.time, .NET/Noda Time, Rust time/chrono, and relevant JavaScript libraries. Compare
   concepts and pitfalls rather than copying one API. Verify current maturity and platform support.
2. Distinguish absolute instants, local dates/times, zoned readings, elapsed Duration and calendar
   periods. Evaluate `DateTime + Duration` and `DateTime - DateTime` versus named operations;
   arithmetic was deferred, not selected. Cover end-of-month, leap years, DST gaps/overlaps,
   timezone database changes and explicit ambiguity/overflow policies.
3. Parsing, validation, machine serialization through datasource/I/O adapters, localized display
   coordinated with A21, precision/range and cross-runtime representations. Keep type/unit meaning
   through boundaries; distinguish known offset from a named timezone.
4. Monotonic clock origins, sleep inclusion and supported-host guarantees; timers across navigation,
   state ownership and test-controlled clocks. Do not pretend a wall-clock fallback preserves a
   monotonic contract or that a timer can be persisted as an origin from another process.
   S62 prohibits actions, I/O and suspension in all functions, including native implementations.
   Clarify how synchronous clock observations in the selected Time/Timer function APIs are
   classified, distinguishing nonblocking intrinsic observations from application I/O. Do not
   silently weaken that function rule or replace the selected API while resolving the boundary.
5. Design [Time.Live](<../Roadmap/Time.Live API.md>): typed modes, refresh cadence, ownership,
   cancellation, background/resumption and efficient shared subscriptions. Consider existing
   Interval/Tick.Value patterns as evidence. Reading current time should not implicitly install one.

## Return and completion

Provide a sourced comparison, explicit type vocabulary, small positive/negative Tao examples,
recommended defaults and escape hatches, adapter/host obligations and diagnostics. Include a
deadline, same-local-time-tomorrow transformation, ambiguous local-time input and ticking UI.
Show both authoring and library/provider implementation contracts, and a scoped MVP recommendation.
Separate questions genuinely needed before implementation from later optional features; settle
remaining choices through R20 and amend Decisions.md before implementation.
