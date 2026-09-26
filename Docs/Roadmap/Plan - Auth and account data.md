# Plan — Auth and account data

Status: local and self-hosted slice implemented, 2026-09-26. The current authorized slice includes
TestAuth/Memory and LocalAuth/Reference, executable Auth Review journeys, and self-hosted InstantDB.
The first Clerk adapter and live browser acceptance against SQLite and InstantDB gateways are implemented.
Physical-device acceptance and advanced account lifecycle features remain outstanding.
The [decisions](<Tao Revolution/Decisions.md>) own language semantics; the
[review record](<Auth syntax review.md>) distinguishes accepted changes from remaining choices.
[MVP scope](<../MVP Roadmap/Developer MVP Roadmap.md>) remains authoritative for priority. This plan
covers the reviewed auth surface and owner/direct-membership rules, not the rest of the R5
authority cluster (publishing, invitations, presence, reusable audiences, and related features).

## Intended result

One Notes app uses the same account data, login UI, actions, and access rules with different auth
and data adapters. Clerk is the first managed auth adapter; a local provider makes development
and headless integration tests independent of a hosted service. Auth owns sessions, credentials,
verified contacts, recovery, and authentication factors. Tao data owns application Accounts,
profiles, preferences, memberships, and roles. Providers supply capabilities behind one interface.

```tao
use Account, Session, SignIn, SignOut from @tao/auth
let Me = Account

data Memberships / Membership {
   Workspace,
   Person Account,
   Role,
   unique Workspace + Person,
}

access Account { Account can read; Account can update DisplayName }
access Note { Owner can read, create, delete; Owner can update Body }
access Workspace { Workspace.Memberships.Person can read }
access Membership { Person can read }

// In a mounted view:
query Mine = Me.Notes with { order by CreatedAt desc }

// In datasource configuration:
// Offline { Me.Notes }
```

These are contract fragments. The executable review app and behavior journeys are in
`Apps/Test Apps/Auth Review/`; package integration tests run that app against a real local HTTP
authority. Passing focused package tests alone does not establish end-to-end acceptance.

## Scope and explicit deferrals

| Area             | Planned contract                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| App binding      | Typed `Auth` configuration, independently of `Datasource`; no auth keyword                      |
| Account identity | Trusted `(issuer, subject)` mapping to opaque application Account ID; never email               |
| Current account  | App-scoped reactive export; shared by views/actions without a process-global singleton          |
| Authentication   | Restore, sign-in, required challenges, reauthentication, cancellation, sign-out                 |
| UI               | Supplied sign-in/account UI plus headless flow actions for custom Tao UI                        |
| Availability     | Site guard > app guard > standard read fallback, resolved per case                              |
| Authorization    | Deny by default; verified caller; direct account/account-set expressions; field-scoped `update` |
| Data syntax      | Comma-separated entries, typed relations, composite `unique A + B`, assigned path queries       |
| Matches          | Bar-form multi-arm `when`, terminal `otherwise`, one RHS or explicit block                      |
| Tests            | In-process TestAuth; local server verification; same interface across auth/data adapters        |
| Offline          | Explicit working set with completeness, persistence, account isolation, acknowledgements        |
| Post-MVP         | Text truthiness and named audiences; neither is an auth prerequisite                            |
| Separate task    | Draft/save design remains deferred; row completeness uses existing required metadata            |

Guest access and simultaneous signed-in accounts are disabled in the review app. Support for these
is not implied by exposing configuration diagnostics. Recovery, MFA, passkeys, linking, and session
management are capability-gated: an adapter must implement them or report their absence explicitly.

## Grammar decisions to close before their slices

1. **Entry boundaries:** require commas between `data` entries, permit a trailing comma, and keep
   whitespace insignificant. `Workspace, Paragraphs` means two inferred fields;
   `Workspace Paragraphs` means one typed field. Preserve parenthesized trait lists and optionality.
   Resolve named enum/value types separately from singular/plural entity targets. Ambiguous inverse
   relations need a diagnostic; do not infer a relationship merely because two types are compatible.
2. **Lists inside entries:** shipped `commands Save, Share` consumes the new separator. Recommend
   `commands { Save, Share }` and `commands hide { Save, Share }`; Ro accepted this spelling when
   authorizing implementation.
   Planned `together A, B` and inline `one of A, B` require the same audit. Recommend `together A + B`
   for a composite fact and named enum types inside data bodies, but these are recommendations,
   not newly settled language rules. Close these choices before implementing entry separators.
3. **Composite constraints:** `unique A + B` constrains the tuple. Independent constraints repeat
   the keyword: `unique A, unique B`. Each current `index` names one field; composite-index design
   remains outside this amendment. Decide null/optional-field behavior and relation-ID equality before
   shipping composite uniqueness. The example uses nonoptional Workspace/Person and row identity.
   Multiple uniqueness constraints must not silently change scalar cross-source reference keys.
4. **Matches:** mandatory terminal `otherwise` resolves ownership of nested arm lists. It does not
   group multiple RHS statements: those retain braces. Value arms take one expression; render/effect
   arms take one atomic statement or nested terminal match, not an implicit statement sequence.
   Prove render/value/effect/predicate and
   subject-less forms, payload binders, and nested terminal-arm bodies with parser/formatter tests.
   Preserve compact boolean `when` pending an explicit compatibility decision; the requested
   universal spelling must not accidentally remove an existing form. Guards remain guard blocks.

## Provider candidates for `Offline { Me.Notes }`

The declaration asks the adapter to synchronize and retain an authorized working set. It is not
a cache hint or an authorization grant. Feasibility below is an architectural assessment, not
proof of a Tao adapter or provider pairing.

| Candidate                        | Fit and required Tao work                                                                                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted InstantDB            | Closest to the existing Tao adapter. Query subscriptions have an offline cache, with a documented default limit of ten subscriptions. Tao must prove retention, initial completeness, durable writes, and supported-platform persistence instead of assuming SDK caching pins an entire set. |
| PowerSync with Postgres/Supabase | Strong fit for explicit offline subsets: subscribed streams replicate into local SQLite; writes enter an upload queue and use an application backend for validation and authorization. Tao would lower the relation scope into streams and enforce writes in that backend.                   |
| Firestore                        | Offline reads, writes, listeners, and reconnect are available, but the documented cache contains actively used data. Tao must add working-set guarantees; React Native requires care because the Firebase JavaScript SDK excludes Firestore persistence there.                               |
| Local reference datasource       | Fully controllable implementation for persistence, disconnect, and rejection tests. Useful contract evidence; not proof that an external SDK has equivalent semantics.                                                                                                                       |

Sources checked 2026-09-26: [Instant initialization](https://www.instantdb.com/docs/init),
[PowerSync streams](https://docs.powersync.com/sync/streams/overview),
[PowerSync client](https://docs.powersync.com/architecture/client-architecture),
[Firestore offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline), and
[Firebase supported environments](https://firebase.google.com/docs/web/environments-js-sdk).

Recommendation: first prove the contract in the local reference datasource, then adapt self-hosted
InstantDB because Tao already has that integration. PowerSync is the preferred additional production
candidate if Instant's capabilities cannot satisfy the contract. Do not add a full PowerSync or
Firestore adapter to the initial scope merely to demonstrate portability. Instant's documentation
announces the Cloud sunset on August 31, 2027; use self-hosted/local integration and keep the language
contract named for remote synchronized data rather than hosted Instant.

## Implementation sequence

Every syntax slice includes parser, scope/type validation, formatter/source actions, compiler,
runtime where affected, diagnostics, and Tao behavior tests. Advance WordFlower through `2 - Next`
then `1 - Current`, following its README; reconcile future examples in the same decision/tranche
amendment. Do not update implemented specs ahead of working behavior.

### 1. Data declaration boundaries and typed relations

Close the inner-list decisions above. Change data entries to a comma-separated list and add
entity/value type resolution for explicit and inferred fields. Preserve singular/plural relation
semantics, trait ownership, and optional fields. Update formatting and source migrations together;
old `(relation ...)` and separator-free examples receive actionable migration diagnostics rather
than silently acquiring a different meaning.

Acceptance: positive and negative parsing on one line and across lines; formatter round trips;
to-one/to-many/inferred enum behavior; nested traits, command lists, comments, and missing-comma
diagnostics. All affected runnable examples migrate in this slice.

### 2. Composite uniqueness, assigned queries, and match syntax

Deliver as small independent slices after their dependencies are ready:

- Add uniqueness constraints to schema metadata and local runtime enforcement; lower them into
  backend constraints in slice 6. Cover two allowed memberships sharing a Workspace or Person,
  rejected duplicate pairs, update collisions, and concurrent creates. Do not encode composite
  keys by naive string concatenation. Preserve the existing scalar reference-key contract; diagnose
  ambiguous keys or unsupported composite-only references rather than choosing arbitrarily.
- Parse `query Name = path with { ... }` into the existing query semantics. Migrate formatting,
  diagnostics, examples, and source actions; do not expand to arbitrary expression sources.
- Implement bar-form matches with explicit termination and RHS boundaries. Migrate multi-arm
  examples only after nested parser/formatter tests prove the rule. Required `otherwise` is a
  boundary rule, not permission to silently discard unhandled auth failures.

Acceptance: behavior and migration tests for each slice; no unsupported backend claims from local
uniqueness tests. Composite server enforcement is a release dependency for the membership model.

### 3. Auth kernel, app binding, and deterministic provider

Introduce typed auth adapter and capability interfaces behind named `@tao/auth` exports. App
configuration chooses a provider; a mounted app owns its context and subscriptions. Implement
Session states and the separate current Account handle with one generation for identity changes.
Discard late results from older generations. `SignedIn` requires provider/MFA follow-up completion,
but application account data can still be loading, missing, unauthorized, or failed.

Add TestAuth and Memory previews plus `signed in as` fixture defaults and optional create bindings.
An explicit fixture actor override affects only that operation; production clients cannot supply
an authoritative actor. Keep sensitive challenge data out of persistence, logs, and recordings.

Acceptance: restore/sign-in/sign-out/cancel/expiry/account-switch state transitions; simultaneous
app contexts do not leak state; MFA-pending never exposes authenticated application data; stale
async responses cannot restore a signed-out account; `Owner: Alice` does not authenticate Alice.

### 4. Read fallback and sign-in/account UI

Supply standard read guards with site > app > library precedence and generic localized copy.
Keep `when Me` as the availability boundary before reading account fields; receiver-availability
propagation is not an implicit part of this slice.

Build supplied `SignInView`, presented `SignIn()`, and headless `SignInFlow` from one state machine.
Normalize completed, cancelled, rejected, and error outcomes separately from queued/saved data
writes. Define retry/reset behavior, challenge expiry, resend cooldown, provider-required steps,
reauthentication, and safe error messages. Unsupported configured methods produce diagnostics;
custom UI can discover available capabilities and fall back to supplied UI for unknown steps.

Provide `AccountView` for profile editing and supported identity-management flows. Profile inputs
remain local until submission. Coordinate row `IsComplete` with the separate completeness task;
do not make login depend on implementing draft/save syntax. Loading a required field is not the
same as an incomplete field, and completeness is neither authorization nor acknowledgement.

Acceptance: Tao journeys for supplied/custom email-code flows, cancellation and retry, failed
onboarding save retaining input, reauthentication returning to context, and guard precedence.
Text conditions stay explicitly boolean; no truthiness change enters this slice.

### 5. Trusted identities and a localhost integration backend

Implement a trusted provisioning operation mapping `(issuer, subject)` to an opaque Account.
Make concurrent first logins idempotent. Keep verified contacts/provider records separate from
editable profile data; linking requires verified control, never equal email addresses. Account
provisioning must allow incomplete application profiles without treating authentication as failed.

Use a small local REST integration surface and a maintained self-hosted email/password auth
implementation selected during adapter work; do not invent password cryptography or add GraphQL
solely for tests. The basic-auth use case means application email/password login. TestAuth remains
a separate deterministic adapter, while this server uses real credential verification, a durable
store, and the production authorization path. Add expiry/revocation controls only to the test harness.

The credential broker requests resource-specific credentials internally. Each resource validates
issuer, audience, expiry, and the trusted identity mapping. Tao source never reads or passes JWTs.
Backend pairings must declare their trust/exchange support; arbitrary auth/data combinations are
not automatically compatible.

Acceptance: offline-local headless end-to-end login, provisioning, profile edit, session restart,
expiry, sign-out, and negative tests for forged identity, wrong audience, unverified email linking,
duplicate provisioning, and client attempts to modify identity mappings.

### 6. Authorization and per-entity remote data

Lower actor-first `access` rules with canonical `update`, direct account paths, and field lists.
Enforce rules at the backend using the verified caller. Preserve the decided post-write rule
semantics; immutable Owner/CreatedAt and explicit mutable-field grants prevent ownership theft.
Treat any future `through` transaction as a trusted enforced operation, never a client-supplied
name that bypasses permissions. Named audiences are not needed for the reviewed MVP policies.

Change Instant persistence from a serialized `taoSnapshots` blob to per-entity data as settled in
[Authority](Authority.md). Retain the existing snapshot-shaped runtime interface initially where
it suffices. Add operation receipts/transaction/subscription capabilities when required by the
offline contract, rather than making a complete protocol rewrite a prerequisite to auth. Filtered
loads must never cause deletion of unread/unauthorized rows during persistence reconciliation.

Acceptance: backend denies anonymous reads, cross-account reads/writes, Owner changes, protected
profile fields, forged memberships, and duplicate composite memberships. Direct membership reads
work. Test rejected multi-row operations and constraint races against the actual backend. If a
backend cannot express a rule atomically, route through a trusted service or diagnose unsupported
capability; client filtering is never a fallback for enforcement.

### 7. Durable offline working sets and logout isolation

Compile `Offline { Me.Notes }` into a live scope tied to the authenticated account. Define the
initial-fill completion signal before exposing the set as fully available offline. Distinguish
unknown/partial/unavailable data from a known empty set. Include required relation identifiers and
metadata; do not recursively cache arbitrary related accounts or workspaces by implication.

Persist set membership, data, and a durable outbox. Define retention/storage limits and expose
incomplete coverage or storage failure rather than silently evicting promised data. Account for
platform storage eviction: loss of persisted state invalidates offline readiness. Writes have
stable IDs, idempotent retries, and distinct local `queued` versus server `saved` receipts. Preserve
recoverable content when a queued write is later rejected or permission is revoked.

On sign-out, immediately clear current credentials and Account, cancel subscriptions, and make
account data inaccessible. The review app removes its readable cache and seals pending writes;
specify encryption/key custody before claiming sealing is secure. Resume sealed writes only after
the same account reauthenticates, with fresh authorization. Delayed callbacks and a new user's
credentials must never expose or transmit the previous user's work. Offline logout cannot promise
immediate remote revocation; retry revocation safely when connectivity returns.

Acceptance: initial sync → process restart with networking disabled → complete declared set reads;
offline create/update/delete → restart → reconnect acknowledgement; late rejection recovery;
logout/switch accounts while requests and writes are pending; server-side access removal on
reconnect; capacity failure and incomplete initial sync. Repeat on supported browser/native storage
paths before advertising parity. A memory-only test does not prove durability.

### 8. Clerk and provider conformance

Integrate Clerk through the same interface and supplied/custom UI. Bind resource credentials to
the selected datasource; when a pairing creates a second backend session, coordinate refresh,
revocation, and sign-out for both. Use self-hosted InstantDB for the first remote data integration.
Its native auth can supply the second production auth adapter where supported; the local
email/password adapter already exercises a second independent auth implementation.

Run the same contract suite with local auth against reference data and Instant data, then Clerk
against those two datasources where the declared trust setup supports it. TestAuth+Memory covers
determinism but does not replace this portability evidence. Keep app source unchanged apart from
provider configuration. Unsupported combinations must fail clearly at setup.

Complete capability-gated account lifecycle UI: verified-contact changes, recovery, MFA/passkeys,
linked identities, session revocation, and deletion. Deletion requires recent authentication and
an idempotent orchestration across auth/data providers; do not promise an atomic cross-service
transaction. Respect the existing redacted Account reference contract while applying the app's
owned-data policy, and retain recovery state if one provider step fails.

Acceptance: managed-provider browser/native journeys for configured methods, expiry and required
challenges, account switching, linking without email merge, revocation, and interrupted deletion.
Report unavailable external credentials or device acceptance separately from local test results.
Declare the tested capability matrix instead of claiming every provider supports every method.

## Dependencies, release evidence, and handoff

- Slices 1 and 2 establish syntax; slices 3 and 4 establish a usable local authoring surface.
  Slice 5 establishes the real identity boundary; slice 6 enforces data authority; slice 7 supplies
  offline guarantees. Slice 8 validates managed adapters and lifecycle parity. UI work can overlap
  backend work after the interface settles, with separate path ownership and no fake security claims.
- Required-field row completeness already exists on main; this slice reuses it for
  `Me.IsComplete` and `Me.IsIncomplete`. Drafts remain a separate design task and are not introduced
  merely to make this design artifact parse.
- Before each implementation slice, recheck the current checkout, instructions, active roadmaps,
  and provider documentation. Use `./agent help` and the repository's focused test/verification lanes;
  update roadmap/spec evidence before final verification. Test the changed behavior during iteration,
  use per-commit checks and completed-slice verification, and propose landing only with authorization.
- Final evidence must include a runnable minimal app, Tao behavior tests, local server denial tests,
  composite-constraint races, durable offline restart/reconnect tests, and provider/platform
  conformance. Keep live managed-provider and physical-device evidence distinct from headless results.
- Implementation and incremental commits are now authorized. Merge main after the implementation
  is complete; landing/pushing still requires separate authorization. Preserve unrelated work.

## Local implementation evidence and remaining acceptance

The Auth Review app now runs against the real localhost account service in an automated Tao
journey: registration, profile update, note creation, logout, rejected credentials, and relogin.
The test compiles the app's trusted policy and independently checks persisted account/note rows.
Rendering and secure storage are test doubles; this does not establish physical-device acceptance.
Memory/TestAuth journeys cover custom, supplied, and presented sign-in UI and cancellation.

Implementation decisions made within the authorized slice:

- Composite uniqueness compares relation IDs and treats tuples containing absent values as distinct.
- Account completeness uses required-field metadata through `IsComplete` and `IsIncomplete`;
  draft/save behavior remains deferred.
- Browser encryption keys remain in memory, requiring online reauthentication after cold restart.
  Native session/cache restoration uses secure-vault storage and unexpired verified sessions.
- Offline checkpoints include declared working sets and pending writes; coverage becomes ready
  only after a complete acknowledged read and durable persistence. Storage failures never report
  an operation as durably queued.
- Navigation persistence is isolated by account and mounted app; logout resets protected navigation
  and data access immediately. Credentials and identity do not become caller-supplied Tao values.
- Background app commands inherit the mounted app's auth scope and wait for its scoped stores;
  command RPC does not introduce a caller-supplied account identity.
- Authenticated data requires an explicit adapter authority capability. Unsupported snapshot/local
  adapters fail before connection; Memory's authority is limited to TestAuth. This prevents an
  unimplemented remote pairing from appearing secure merely because the client filters its rows.
- Concurrent mounts coordinate one durable checkpoint and accepted snapshot. Browser persistence
  requires Web Locks and rejects a second tab; native multi-process writers remain unsupported.
  A reproduced lost-write race now has restart, duplicate-acknowledgement, and stale-logout tests.

Self-hosted InstantDB now uses the same LocalAuth/Reference app through an Instant-backed account
gateway. The actual Tao journey and independent admin reads establish that profiles and notes
persist in individual Instant entities. Live conformance also exercises owner/field/membership
denials, duplicate tuple races, batch rollback, ambiguous responses, retry receipts, process death,
and offline checkpoint recovery. The stack was started externally; named host capabilities now
work. No permission alias or sandbox bypass was added.

Decisions for this local deployment:

- SQLite owns credentials, sessions, encryption keys, and stable external identity mappings.
  Instant owns application rows and operation receipts; it is not a replica of SQLite row storage.
- Backend selection is trusted gateway configuration (`--instant-config PATH`). App source,
  session actions, policies, and the Reference wire protocol remain unchanged. Admin credentials
  never enter the client. The old Instant snapshot adapter still rejects authenticated pairing.
- One gateway owns its original identity database. A lifetime SQLite lock rejects a second process;
  an immutable remote binding rejects another database or policy. Copying the identity database
  to run additional gateways, policy migration, and distributed failover are unsupported.
- Fresh unique revision and receipt records commit atomically with all entity changes. On an
  uncertain result the gateway checks the receipt and reloads authority state before retrying.
  Startup and acknowledged revocation consume a revision to fence old in-flight requests.
- Stable local identity commits before remote Account provisioning; sign-in repairs interruption
  before returning a session. Storage modes cannot be silently switched on an existing database.
- Startup verifies literal deny-all programs for managed entities and schema writes before
  accepting application data. Administrator mutation after startup remains a deployment boundary.

Live tests require `TAO_INSTANT_LIVE_API_URL` and create isolated ephemeral apps; an unset variable
reports skipped tests. They do not replace browser or physical-device acceptance. The task's
verification record owns the final integration evidence. Clerk and physical-device lifecycle
acceptance remain outside this first local slice.

## Clerk implementation and remaining acceptance

`@tao/auth/clerk` now binds `PublishableKey`, `Endpoint` and `Resource` through the existing Auth
slot. It uses the real Expo SDK through a provider-owned host, custom/supplied Tao flows, and the
same Reference datasource. Password/email-code registration and login, required email verification,
email Device Trust, restoration, refresh, account changes, cancellation and logout are implemented.
Unsupported MFA, session tasks and other instance requirements fail closed.

The trusted gateway verifies pinned public-key Clerk proofs offline, binds issuer/subject to the
local Account, and limits its opaque resource session to the proof deadline. Its database is bound
to one auth mode and issuer; local-password routes cannot bypass Clerk. SQLite and Instant data
storage remain unchanged. Interrupted SDK logout persists non-secret session-ID tombstones;
restoration will not silently reuse an abandoned session. Real restore/renewal requires connectivity;
the experimental offline SDK cache is not enabled.

Focused tests cover SDK translations, stale completions, revocation retries, renewal deadlines,
issuer/origin/audience/signature checks, and database mode isolation. A separate opt-in browser
journey bundles the actual Auth Review app and drives password and email-code UI against a dedicated
Clerk development instance. It accepts the three Clerk credentials from the repository secrets
store after explicit live opt-in, with environment overrides and no process-wide secret exports.
Setup failures expose bounded API codes and known missing field names rather than raw SDK errors.
Its testing token only bypasses bot protection. The live journey passed on 2026-09-26, proving
password sign-in, profile and owned-note persistence, reload, logout, email-code sign-in and a second
logout against the SQLite reference gateway. The run exposed Clerk's default sign-out navigation;
targeted logout and cancellation revocation now use the SDK completion callback so Tao owns navigation.
The same journey passed against local InstantDB on 2026-09-26, independently querying Account and
Note rows and proving direct guest reads are denied. `just setup-clerk` guides saved Dashboard
settings, validates matching development keys, retrieves the public signing key and stores the
three credentials encrypted. It preserves concurrent unrelated secret-store edits and refuses
conflicting credential/recipient changes. Physical-device lifecycle acceptance remains outstanding.
The gateway defaults to requiring an `azp` origin claim. The approved native opt-in,
`allowMissingAuthorizedPartyWithoutOrigin`, accepts a missing claim only when the actual HTTP
request has no Origin header; any present claim must still match the configured authorized parties.
Browser requests, including null or empty Origin headers, retain the strict policy. This trusts a
verified bearer session and does not attest a physical device. `just clerk-review` prepares a
development gateway and local InstantDB behind Studio for manual Companion review.
The authored iPhone scenario has mounted on a connected phone. Manual review exposed an unmasked
custom password input and truncated failure text; secure input and wrapped messages address those.
Known Clerk configuration errors now have fixed messages distinct from rejected credentials.
Follow-up phone review identified Clerk rejecting registration with a password equal to the email.
Separate review fill values, compact scrolling input rows, explicit sign-in/registration selection,
and a visible verification-code step address the observed form issues. Completed real registration
and account-data persistence on the phone remain manual acceptance work.
Advanced recovery, OAuth, MFA/passkeys,
linking, deletion and production gateway deployment are not part of this initial implementation.

## Original implementation seams

These describe the starting checkout, not the implementation above; retain them as the checklist
for reviewing each changed boundary.

- `packages/language/parser/parser-grammar/data.langium`: undelimited entries, primitive/boolean
  field types, single-field indexes, and command lists sharing commas.
- `packages/language/validator/validator-src/validators/data-validator.ts` and
  `packages/compiler/compiler-src/codegen/app/DataCompiler.ts`: single primitive unique field and
  scalar reference-key generation; composite constraints need new representation and semantics.
- `packages/language/parser/parser-grammar/scenarios.langium`: create bindings and actor override;
  `signed in as` and optional bindings need grammar/runtime changes.
- `packages/apps/runtime/TaoRuntime-src/TR.ts`: member reads do not inherit receiver availability.
- `packages/apps/runtime/TaoRuntime-src/TR-data.ts`: existing connect/load/save/subscribe seam;
  avoid planning from the older load/persist-only handoff.
- `packages/apps/stdlib/@tao/data/providers/instantdb/InstantDB.ts`: snapshot persistence must become
  per-entity storage before external rules can protect individual application entities.
