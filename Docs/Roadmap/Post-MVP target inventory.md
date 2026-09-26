# Post-MVP target inventory

The Developer selected these targets from the post-MVP discussion on 2026-09-25. Sections 1–6
preserve the server-side brainstorm's numbering so later discussion can refer to an item precisely;
section 7 collects additional selected proposals.
Selection means **keep the capability as a target**; it does not set implementation order, settle its
language syntax, or claim that the supporting server exists. Each target still needs a scoped design
and an acceptance journey before implementation.

Tao's existing decisions remain authoritative where they apply: provider-owned scheduled
`automation` in [Tao Revolution §12](Tao%20Revolution/Decisions.md#12-automations), the closed
`Assistant` projection in [§8](Tao%20Revolution/Decisions.md#the-ai-surface), and access and
publication rules in [§§3–4](Tao%20Revolution/Decisions.md#3-authority). This inventory extends
those directions without silently broadening their authority.

## 1. Durable work

- [ ] **1a. Data-triggered actions.** Run declared work when an entity changes state.
- [ ] **1b. Long-running workflows.** Persist a multi-step process across waits, deployments, and restarts.
- [ ] **1c. Approval checkpoints.** Pause work for a person's decision and resume from the same point.
- [ ] **1d. Per-record deadlines.** Derive cancellable one-off work from each entity's date or state.
- [ ] **1e. Reliable external effects.** Use durable outbox records, retries, and idempotency
      keys for effects outside Tao's store.
- [ ] **1f. Bulk operations.** Run large imports, recalculations, or notifications with progress, pause, and resume.
- [ ] **1g. Workflow versioning.** Allow running instances to finish safely as their authored workflow evolves.
- [ ] **1h. Repair queues.** Inspect failed work, understand its cause, and replay or dismiss it deliberately.

## 2. Connections to the outside world

- [ ] **2a. Inbound webhooks.** Verify outside events and translate them into typed Tao events.
- [ ] **2b. Outbound webhooks.** Let outside systems subscribe to an explicitly exposed subset of Tao events.
- [ ] **2c. Connection vault.** Hold and refresh each user's delegated service credentials under their identity.
- [ ] **2d. Typed connectors.** Map an external service's objects and actions into Tao nouns and verbs.
- [ ] **2e. Import pipelines.** Map, validate, deduplicate, and preview external data before committing it.
- [ ] **2f. Files and media.** Process uploads, transformations, transcription, thumbnails, and delivery.
- [ ] **2g. Payments and entitlements.** Connect purchases and subscriptions to Tao account access.
- [ ] **2h. Delivery services.** Coordinate email, push, SMS, and in-app messages with preferences and delivery history.

## 3. Data capabilities beyond synchronization

- [ ] **3a. Server-computed views.** Maintain derived records that clients should not each recalculate.
- [ ] **3b. Large aggregates.** Answer aggregate questions without downloading all contributing rows.
- [ ] **3c. Generated search indexes.** Keep text or meaning-based search aligned with Tao declarations.
- [ ] **3d. Authorized cross-datasource joins.** Compose data from different providers at a trusted boundary.
- [ ] **3e. Schema migrations.** Evolve deployed data while older app versions still run.
- [ ] **3f. Record history.** Inspect past changes and restore a prior version under the same authority rules.
- [ ] **3g. Lifecycle rules.** Archive, expire, anonymize, or delete data after declared conditions.
- [ ] **3h. Portable export.** Give people and organizations documented, usable copies of their data.

## 4. Shared applications

- [ ] **4a. Organizations and teams.** Model memberships, roles, invitations, and delegation across users.
- [ ] **4b. Presence.** Show who is viewing or editing beyond synchronization of stored data.
- [ ] **4c. Reservations and soft locks.** Coordinate people contending for the same scarce resource.
- [ ] **4f. Scoped guest access.** Grant a specific person access to a specific object for a limited purpose.

## 5. Operating a Tao service

- [ ] **5a. Generated observability.** Trace a verb through authorization, writes, jobs, and external effects.
- [ ] **5b. Audit trails.** Record consequential actions with actor, time, reason, and affected entities.
- [ ] **5c. Generated admin console.** Inspect jobs, connections, users, failures, and access decisions.
- [ ] **5d. Safe releases.** Support preview environments, canaries, rollback, and migration checks.
- [ ] **5e. Old-client compatibility checks.** Detect server changes that break still-active app versions.
- [ ] **5f. Backups and rehearsed restores.** Prove recovery of stored data and pending work.
- [ ] **5g. Region and tenant placement.** Control where data and execution live and how tenants are isolated.
- [ ] **5h. Quotas and abuse controls.** Apply rate limits, spending caps, and protections to specific verbs.
- [ ] **5i. Cost visibility.** Attribute compute, storage, model, and outside-service costs to features and customers.
- [ ] **5j. Evidence generation.** Produce records of deployments, access changes, tests, and
      incidents for compliance work; a certification remains an organizational process.

## 6. Tao-shaped capabilities

- [ ] **6a. Semantic workflow recording.** Propose an automation in Tao nouns and verbs from an
      observed task, rather than replaying taps.
- [ ] **6b. Cross-app compositions.** Connect typed, permissioned actions across a person's Tao apps.
- [ ] **6c. Device/server handoff.** Schedule an intention on the server and execute its
      device-only part when the person's device can do so.
- [ ] **6d. Explainable actions.** Show which declared rule permitted or refused an action.
- [ ] **6e. Effect previews.** Show the rows, notifications, and outside calls an automation
      would produce before enabling it.
- [ ] **6f. Agent-facing apps.** Compile an app's explicitly exposed nouns and verbs into a
      documented headless CLI and other agent targets. The CLI target should emit TypeScript for Bun
      and invoke commands without mounting a UI; direct access to private actions is outside the
      exposure boundary.
- [ ] **6g. Integration drift detection.** Detect changes in outside service responses and
      identify affected Tao mappings.
- [ ] **6h. Time-travel simulation.** Replay recorded events against proposed rules or workflows before deployment.
- [ ] **6i. User-owned automation library.** Share workflow templates while each installation
      supplies its own accounts, permissions, and connections.

## 7. Additional selected targets

- [ ] **7a. Feature transplant.** Select a working feature in Studio and graft it into another
      Tao app. Extract its required data types, views, commands, rules, copy, and tests; map them to
      concepts the destination already has; show unresolved choices and a checked adaptation before
      applying anything. The first demo moves Skillet's meal planner into Hearth.
- [ ] **7b. App constellations.** Connect separately installed Tao apps through explicit, typed,
      revocable grants. Each app retains its own data and authority while a person can coordinate
      facts and actions across them. The first demo lets a Wayfare trip use Skillet recipes to plan
      meals and create Hearth preparation tasks without a bespoke integration.
- [ ] **7c. Apps beyond their windows.** Compile selected Tao app experiences for widgets,
      Live Activities, complications, multiple windows, spatial presentation, and other suitable
      host surfaces. The existing
      [navigation follow-up](Add%20navigation%20and%20routing%20MVP/Follow-ups%20-%20Add%20navigation%20and%20routing%20MVP.md#def-nav-003-multiple-windows-and-spatial-presentation)
      defers these until further runtime targets exist.
- [ ] **7d. Real-device failure to regression test.** Capture a physical-device failure, replay
      its fingerprint, remove irrelevant steps, save the minimized state and journey as a failing
      test, and link the passing regression after the fix. This is already a
      [settled companion-app direction](Tao%20Studio%20companion%20app/Plan%20-%20Tao%20Studio%20companion%20app.md#additional-high-leverage-target-2-reality-to-regression);
      the target here is its delivery.
