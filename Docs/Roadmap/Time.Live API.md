# Design the Time.Live API

- [ ] Design a library API named `Time.Live` for time that stays up to date.

Requested during the timer/type-system dialogue (Syntax sketches S55, amended in S56). This is design work;
implementation is not selected. S57 assigns review of the remaining time API, including this design,
to pre-MVP [A30/R21](<../MVP Roadmap/Review - Dates and time APIs.md>).

## Selected context

```tao
let Timer = Time.StartTimer()
do Wait(2 Seconds)
let Duration = Timer.Duration() // Fixed elapsed sample; includes device sleep; keeps measuring.
let CreatedAt = Time.Now()  // DateTime absolute wall-clock instant.
```

Each Duration call returns a fixed sample, not a live value; later calls can return later samples.
Timers are runtime-only, nonpersistent handles; state initialization owns one per mounted view
instance. Live time should not make these ordinary calls implicitly install a ticker. Stop is not
part of the selected API.

## Investigate

1. Whether Live exposes wall-clock DateTime, elapsed Duration, or separate explicitly typed modes;
   distinguish wall-clock correction from monotonic elapsed measurement.
2. Construction, refresh cadence and ownership: mount/unmount, backgrounding, cancellation,
   shared subscriptions and test-controlled clocks. Recompute after resumption rather than replaying
   every missed tick; decide the exact behavior instead of assuming it here.
3. Display precision versus update cadence, unit-preserving readings, and whether updates align to
   visible boundaries. Avoid per-render timer creation and unnecessary whole-tree updates.
4. Relationship to the existing Interval/Tick.Value pattern in WordFlower Focus and the library-clock
   direction in Decisions.md. Reuse useful implementation seams without treating existing syntax as
   a requirement. Define host clock and sleep-inclusion guarantees separately from callback delivery.

Done when a small count-up/countdown and current-time example specify the API, inferred types,
refresh/lifecycle behavior, deterministic tests and supported-host limitations. Amend the active
decision record before implementation.
