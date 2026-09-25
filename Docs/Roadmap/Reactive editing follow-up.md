# Reactive editing follow-up

The implemented editing surface is documented in [Tao Type System](../Spec/Tao%20Type%20System.md),
[Tao Actions](../Spec/Tao%20Actions.md), and [Tao Data](../Spec/Tao%20Data.md). WordFlower Current uses
projected input items, explicit copies, writable field parameters, bulk updates, and row-owned write
status. The implementation can ship independently of the deferred work below.

## Deferred decisions and work

1. **Snapshot-provider recovery.** InstantDB and iCloud currently replace whole-store snapshots.
   Durable retry requires an acknowledged mutation protocol that preserves the identity and exact
   payload of every submission. Decide the migration and compatibility policy before implementing
   this for those providers. Until then their recovery counts are zero, `CanRetryWrites` is false,
   and explicit retry is unsupported; zero counts do not prove remote synchronization.
2. **Server-enforced validation.** Decide how authoritative validation is declared, enforced by each
   provider, and reported back to forms and actions. Do not present client-only checks as backend
   guarantees. This remains deferred; projected input types introduce no validation schema.
3. **External acceptance.** Exercise the native mutable-input callback lifecycle on a device and
   granular recovery against live CloudKit, including failure, relaunch, retry, and concurrent edits.
   Runtime regressions and Tao journeys cover the local contract, not those external services.

WordFlower absorbed the reactive-editing tranche at the implemented boundary above; its header names
these deferrals. Resume any of them as a new tranche opened in WordFlower Next.

These items can be resumed from this document without the original design conversation. None implies
that provider parity or server validation has been completed.
