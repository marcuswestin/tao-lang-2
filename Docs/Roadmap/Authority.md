# Authority — design exploration

Status: **exploration, dialogue open**. The Framing and the sketches are a thousand-mile
overview of how the decided authority model lands on real providers; the Direction section will
record what dialogue with Ro settles. Nothing here is language law until it reaches
`Tao Revolution/Decisions.md`, which wins wherever the two collide. The decided model itself —
§2 secrets and redaction, §3 access rules, §4 the public boundary, §11 identity — is not
reopened here; the design space is everything between those decisions and a provider that
actually refuses.

## Framing

Tao's most differentiating promise is that a reviewer answers **who may touch what** from one
short file. The demo apps already state the doctrine (`Apps/Tao Future/Skillet/Access.tao-revolution`):

> "One file, because security you have to assemble from twelve scattered lines is security
> nobody reviews. Everything below is enforced by the store. No screen in this app decides
> whether a person may do something — it asks (`can change Recipe`) and the answer comes from
> here."

The promise is currently unproven end to end: none of the authority grammar exists, `@tao/auth`
is prose, no provider ever sets the (fully wired) `unauthorized` state, and the shipped
InstantDB provider persists the entire store as one opaque JSON string that no server rule can
see inside. This program takes the decided model to a real two-account app on InstantDB:
accounts and `Me`, rules enforced by the store, `publish` and share links over `secret` values,
invites, and account deletion as redaction.

The through-line, parallel to "the `data` declaration is already the generation schema":

> **The access file is already the provider's rule file.** An `access` block's audiences,
> field scopes, `through` grants, and holder-of-secret clauses are exactly what a store's
> server-enforced rule language needs — and they are already written, reviewable, in one file.
> The compiler emits what a security engineer would hand-write in the provider's own rule
> language; nothing is duplicated by hand, so nothing can drift. (§2 already decides this for
> cross-row validates; this program extends the same principle to the whole authority surface.)

Three consequences the design must deliver:

1. **The server is the authority; the client is a mirror.** The same declared rules evaluate in
   two places: lowered into the provider's rule language for enforcement, and compiled into the
   client runtime so `can change Recipe` answers instantly, offline, and honestly. The client
   copy is a courtesy; the server copy is the truth; both come from one source.
2. **A remote refusal is shaped like a local one.** A server rejection arrives as the same
   `rejected` / `unauthorized` vocabulary a local `refuse`/`validate` produces, carrying the
   declared sentence — never a raw provider error, never English authored outside Tao source.
3. **Enforcement is the security model for everything downstream.** Agents act as `Me` and are
   sandboxed by these rules; multiplayer revocation surfaces through this refusal contract;
   `as <Account> … expect refused` is the test vocabulary for all of it.

**Scope boundary**: real-time sync granularity, offline reconciliation, conflicts, and presence
belong to a follow-on multiplayer program. This program is the policy-and-semantics layer —
rules are enforced server-side regardless of how granular the client's writes are — plus the
minimum provider substrate that makes server-side enforcement possible at all (see below).

## Ground truth

What exists today, established against the working tree:

- **Decided, specced, unimplemented.** `access`, `audience`, `publish`, `transaction`,
  `secret`, `holder`, `refuse`, `validate` — zero grammar hits; only `required` parses.
  `@tao/auth` does not exist as a package. `Me` is a convention in `.tao-revolution` sketches.
  The `unauthorized` guard case is wired end to end (parser → runtime) and nothing ever sets it.
- **Coverage**: the authority cluster (§3, §4, redaction §2, holder-of-secret) is tier-TBD with
  no forcing feature — `Process.md` step 4 deliberately holds open whether it enters MVP via
  collaborative WordFlower workspaces or waits for the app expansion. "auth library, Me binding
  (§11)" is **MVP, pending**. This program produces the evidence that scope call needs.
- **The provider substrate collision.** The shipped InstantDB provider stores the whole store as
  one JSON blob in a single `taoSnapshots` row. InstantDB's rules gate namespaces and rows; they
  cannot see inside a serialized string. Server-enforced per-entity authority is therefore
  structurally impossible over today's persistence shape — the provider's own roadmap carries
  the matching open question ("keep snapshot sync or introduce an explicit entity/change
  protocol before calling the provider production-ready"). Some form of per-entity storage is a
  prerequisite of this program, not an optional improvement.
- **InstantDB's rule machinery is a strong match** (details in the lowering map): CEL rules per
  namespace over `view`/`create`/`update`/`delete` plus a field-level `fields` clause;
  `ruleParams` is its documented share-link pattern — the decided §4 lowering names it;
  `data.ref`/`auth.ref` traverse multi-hop links; `newData`/`request.modifiedFields` support
  "checked against the row as it will be"; guest auth supports anonymous published reads;
  rejected writes return a typed `permission-denied` body naming the failing rule. Three real
  frictions: mid-path audience filters (`[Role in Owner, Cook]`) exceed a single `ref`
  traversal, `$users` rows cannot be deleted from a client, and `fields` rules only filter what
  a query returns (secrecy needs view rules too).

## What the language derives vs what the provider owns

| Concern           | The language derives                                                                                                              | The provider owns                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Rules             | Lowering of `access` / `audience` / `publish` / cross-row `validate` into the provider's rule language, deployed by the toolchain | Evaluating them on every read and write, server-side, unconditionally                           |
| Identity          | `Me` as an ordinary binding; the `Account` entity extension; fixture accounts                                                     | Sign-in flows (magic codes, OAuth), the authenticated principal a write arrives under           |
| `can …` questions | A client-side evaluator compiled from the same declared rules                                                                     | The authoritative answer when the write actually lands                                          |
| Secrets           | The `secret` type: generation, rotation, structural exclusions (never in prompts, logs, captures)                                 | Unguessable storage, matching a presented capability against a row                              |
| Refusals          | The rule ↔ sentence map; classification into `rejected` / `unauthorized`; translatable copy                                       | The typed rejection naming which rule refused                                                   |
| Redaction         | `DeleteMyAccount`-style transactions ending in `delete Me`; which fields clear; the stand-in phrase                               | Deleting/redacting the auth record itself (an admin-lane operation on every candidate provider) |
| Deployment        | Emitting schema + rules as build artifacts; versioning them with the app                                                          | Accepting pushed rules; enforcing the currently deployed set                                    |

## The lowering map (InstantDB)

How each decided construct lands, with the three genuinely open rows flagged. Everything in
this table is examples-to-provoke, not settled.

| Tao construct                           | InstantDB mechanism                                                                                                | Status                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Deny by default                         | `"$default": "false"` on every namespace                                                                           | direct                                                 |
| `read to <audience>`                    | per-namespace `view` rule (server filters query results)                                                           | direct                                                 |
| `audience` with a role filter           | **not one `ref` traversal** — see "Audience materialization" below                                                 | **design area**                                        |
| `create … where <new row>`              | `create` rule over `data` (the new object); additive grants OR together                                            | direct                                                 |
| Field-scoped `change`                   | `update` rule over `request.modifiedFields` + `newData`                                                            | direct                                                 |
| `holder of <Field>`                     | `ruleParams` — InstantDB's own documented share-link pattern                                                       | direct                                                 |
| `create/change … through <Transaction>` | **no server notion of "which transaction"** — see "Remote authorization semantics" below                           | **design area**                                        |
| `publish` projection                    | `fields` clause (allow-list) + `view` rule (row filter + capability) + guest auth for anonymous resolution         | direct, with care: `fields` alone only filters returns |
| Capability rotation                     | ordinary field write; links resolve by `where Code = ruleParams.code`                                              | direct                                                 |
| Cross-row `validate`                    | generated per-operation rules (§2 decides this verbatim)                                                           | decided                                                |
| Remote refusal                          | `permission-denied` body names the failing rule → compiler-emitted rule↔sentence map → `rejected` / `unauthorized` | design area                                            |
| Account redaction                       | client-side field clearing + an admin lane for the `$users` record                                                 | **design area**, seam with `tao ship`                  |
| Rules deployment                        | `push perms`-equivalent from the toolchain; no provider-side versioning                                            | design area, seam with `tao ship`                      |

### The three hard problems

**1. The substrate.** The provider must persist entities as rows in per-entity namespaces for
any rule to bite. The runtime's whole-snapshot provider contract can survive if the provider
composes loads from namespace queries and decomposes saves into per-row `transact` ops (a diff
against the last confirmed state) — the sync program later replaces the diffing with a real
change protocol, but the _storage shape_ it needs is the same one rules need now. Alternatively
this program waits for an entity/change protocol first, which inverts the program order.

**2. Remote authorization semantics for `through` grants.** A Tao transaction compiles to
client code performing one atomic `transact`. The server cannot know the client "ran
`JoinWithInvite`" — a hostile client sends raw ops. The Tao-native candidate: the compiler
lowers a `through` grant into rules that verify the _effect shape_ — the created/changed row is
permitted exactly when the transaction's own `refuse when` conditions and write pattern hold
over the atomic change-set (e.g. a `Membership` create is allowed when the same transact marks
a matching, unused, unexpired `Invite` as `Used` and `ruleParams` carries its code). "The
duplication a security engineer writes by hand is what the compiler emits" — extended from
validates to transactions. The honest question is expressiveness: what a `through` grant may
contain is bounded by what post-state rules can verify, and the compiler must refuse to compile
a transaction it cannot enforce remotely (a loud diagnostic, never silent advisory-only
security). The alternative — a trusted server lane executing transactions — is real
infrastructure with a different trust story, and collides with `tao ship`'s hosted-runtime
design; it should not be chosen by default here. Related unverified assumption to probe early:
§3 decides "a write is checked against the row as it will be" across the whole transact
(the invitation creates the very membership that then protects it); whether InstantDB evaluates
each op's rule against the post-state of the full atomic transact needs a spike before anything
else depends on it.

**3. Audience materialization.** `audience Cooks for Household =
Household.Memberships[Role in Owner, Cook].Person` needs a _correlated_ check — the same
membership row must match both the person and the role — but `data.ref('…')` flattens a path to
a list of terminal values, so two separate traversals produce a cross-product (a cook anywhere
would pass). The hand-written InstantDB pattern for this is materialized role links, and the
compiler can own them: each role-filtered audience becomes a maintained link
(`household.cooks ↔ $users`), updated in the same atomic transact as any membership write that
affects it — derived storage, like `(ordered)` positions, never hand-maintained. Unfiltered
audiences (`Family = Household.Memberships.Person`) lower to a plain traversal.

## Sketches (examples to provoke)

### The account shape

InstantDB's `$users` namespace is deliberately minimal (email, immutable client-side; delete
rule fixed to `false`). The decided `data Accounts / Account with { … }` extension maps to a
provider-owned `accounts` namespace linked one-to-one to `$users` — the documented profile
pattern, emitted by the compiler:

```tao
// App source (decided form)
data Accounts / Account with {
   Memberships (owned)
   preference Units is one of Metric, Imperial (default Metric)
}
```

```
$users        — InstantDB's auth record: id, email        (provider truth, client-immutable)
accounts      — Name, Photo, preferences, app extensions  (Tao's Account row, linked $user)
```

`use Account from @tao/auth` / `let Me = Account` binds the live signed-in account handle
(loading / none / available), backed by the datasource's own auth — magic codes first. Fixture
`account Ro { … }` rows and journey `as Ro …` steps bind test principals through the same seam.

### The emitted rule file

One `access` block, and what the toolchain deploys (abbreviated, dialect illustrative):

```tao
access Recipe {
   read to Family of Household
   create, change to Cooks of Household
   change Shared, ShareCode through StartSharing or StopSharing
   delete to Owners of Household
}
```

```ts
// generated by `tao` from Access.tao — never hand-edited
recipes: {
  bind: [
    "family", "auth.id in data.ref('household.family.id')",   // materialized audience links
    "cooks",  "auth.id in data.ref('household.cooks.id')",
    "owners", "auth.id in data.ref('household.owners.id')",
    "sharingFieldsUntouched",
      "!('shared' in request.modifiedFields) && !('shareCode' in request.modifiedFields)",
  ],
  allow: {
    "$default": "false",
    view:   "family",
    create: "cooks",
    update: "cooks && (sharingFieldsUntouched || /* StartSharing|StopSharing effect shape */)",
    delete: "owners",
  },
}
```

A reviewer reads the Tao; an auditor can read the emitted file; they cannot disagree.

### The remote refusal round trip

```tao
on press -> { do LeaveKitchen(MyMembership) }
```

1. The client evaluator already answered `can delete Membership` — the button was visible.
2. Meanwhile an owner demoted this member; the server's deployed rule refuses the op.
3. InstantDB returns `permission-denied` naming the failing rule expression.
4. The runtime resolves it through the compiler-emitted map: a lowered `validate` yields its
   own sentence ("A kitchen needs an owner. …"); a plain access grant yields the
   `unauthorized` shape (no sentence of its own — access rules deliberately carry none).
5. The outcome lands exactly as a local refusal would: `rejected` with `Problem`, or
   `unauthorized` through `guard default` — same vocabulary, same copy, translated the same
   way. In the Studio v2 failure ladder, this is a provider failure that selects a _declared_
   case and sentence; a genuinely unmapped provider error (rule drift, outage) stays `error`.

### Secrets and the share link

```tao
data Invites / Invite {
   Code secret (default new secret)
   unique Code
}

link JoinLink(Code secret) "/join/{Code}" -> { present JoinKitchen(Code) as sheet }
```

- `secret` is a value type the runtime generates from platform CSPRNG entropy — unguessable,
  rotatable, comparable, and structurally excluded from prompts, failure captures, and logs
  (the ship exploration already extends the same exclusion to its telemetry).
- A link opens anonymously: the provider signs in a guest, the published projection's `view`
  rule admits the row whose code matches `ruleParams`, and nothing else resolves. `JoinWithInvite`
  presents the code to the transaction, making the caller `holder of Code` for that call.
- Non-holders can never read a secret field back: the lowering pairs the `fields` allow-list
  with view rules, because `fields` alone only filters what one query returns.
- Deploy credentials (`AppId`, admin tokens) are a **different species** — `tao ship` owns
  them; the two programs share only the word and must not share the type (`config` vs `secret`
  is flagged in both explorations).

### Redaction

```tao
transaction DeleteMyAccount() for Me {
   delete Me.Memberships
   delete Me            // redacts, never removes: Name, Email, Photo clear; the row survives
}
```

Client-side, `delete Me` lowers to clearing the `accounts` row's identifying fields — an
ordinary permitted write, refusable by the owner invariant with the household's own sentence.
The `$users` auth record cannot be deleted by any client; finishing the job (email release,
sign-in revocation) is an admin-lane operation. Where that lane lives — toolchain command,
ship-owned hosted task, or deferred with the auth record merely orphaned and inert — is a
decision, and a seam with `tao ship`'s hosted-runtime story.

## The driving use case: two accounts, one household

A real app on the InstantDB provider, exercised by behavior tests — the proof the promise
needs. One Skillet-shaped household, small enough to build early:

1. **Ro starts a kitchen** — `StartKitchen` creates household + owner membership atomically;
   the owner invariant holds from the first commit.
2. **Ro invites by link** — an `Invite` with a fresh `Code secret`; the link renders the
   published projection to a signed-out phone.
3. **Sam joins** — `JoinWithInvite(Code)` on a second account: holder-of-secret authorizes
   marking the invite used and creating the very membership that then protects it. A second
   use, and a use by the wrong email, are refused with their own sentences.
4. **Permissions on every write** — Sam (a cook) edits a recipe; demoted to guest, the same
   edit is refused server-side even from a stale client that still shows the button.
5. **A member leaves** — `delete Membership`; the last owner is stopped by the invariant's
   sentence, lowered into the store's own rules.
6. **Sharing and revocation** — publish a recipe behind `ShareCode`; the projection ships
   exactly the allow-list; rotating the code kills every handed-out link.
7. **An account is deleted** — redaction, not removal: `CompletedBy` reads as the stand-in
   ("Former member"), `together` pairs stay whole, the household and its recipes survive.

Test sketch, in the decided vocabulary:

```tao
as Sam update Shakshuka { Title: "Sam's Shakshuka" }   // Sam is a guest now
expect refused
expect Shakshuka.Title is "Shakshuka"
```

The same journeys run against `Datasource Memory` (rules evaluated by the client evaluator
alone) and against the live provider (rules enforced by the deployed CEL) — one of the
strongest claims available: the policy layer behaves identically on both sides of the wire.

## Cross-program seams

- **Multiplayer sync** (downstream): consumes this program's refusal contract — an offline or
  concurrent write arriving after revocation must surface as the same validate/refuse-shaped
  rejection as a local refusal. Presence visibility inherits sharing semantics. The provider
  substrate decided here (per-entity rows) is the storage shape that program builds its change
  protocol on.
- **Studio v2 error architecture**: remote refusals land in the implemented failure ladder —
  provider selects a declared case + sentence; failure captures structurally exclude
  secret-bearing fields (already implemented on their side; `secret` gives it a type to key on).
- **`tao ship`**: three shared surfaces, all flagged in its exploration — deploy credentials
  (`config`, not `secret`), rules/schema push as part of the deploy pipeline (drift between
  deployed rules and released clients is a joint versioning question), and any admin lane for
  redaction. Surface collisions; neither program decides alone.
- **AI in Tao apps**: agents act as `Me` and are sandboxed by these rules; `as assistant do …
  expect refused` shares the test vocabulary. Nothing here designs for agents, and nothing may
  foreclose them — in particular, refusals must be observable by the caller (an agent needs to
  learn "not permitted" as data, which the outcome vocabulary already provides).
- **Studio as a Tao app**: multi-account fixtures (`account` rows, `as <Account>` steps,
  fixture sign-in) must work in Studio's preview/scenario machinery — scenario `signed in as`
  states become part of the environment matrix.

## Open questions, gathered

1. Does InstantDB evaluate each operation's rule against the post-state of the whole atomic
   transact? §3's "checked against the row as it will be" depends on it; needs a probing spike
   before the `through`-grant lowering is designed in detail.
2. How far can effect-shape lowering carry `through` grants — and what does the compiler say
   when a transaction body exceeds what the provider's rules can verify remotely?
3. Audience materialization: compiler-maintained role links, or a constrained audience grammar
   that stays within one traversal? What keeps materialized links atomic with membership writes?
4. The client-side evaluator: one rule engine compiled to both CEL and the runtime, or two
   backends over one typed rule IR? Where does `can …` get its data when the audience path
   crosses rows the caller cannot read?
5. Refusal mapping: is matching on the provider's failing-rule report robust enough, or should
   emitted rules carry stable identifiers the runtime resolves without string-matching?
6. What exactly does `delete Me` clear — the decided trio (Name, Email, Photo) plus all
   app-declared extension fields? Do preferences survive redaction? Where does the admin lane
   for the `$users` record live?
7. Rules deployment and drift: a deployed rule set serves old and new clients simultaneously;
   who versions it, and what does a client on stale rules experience? (Joint with `tao ship`'s
   schema-migration option space.)
8. Anonymous published reads: guest-auth session per link open, or unauthenticated fetch where
   the provider allows it? What does the `SharedRecipeScreen` availability story look like with
   no account at all?
9. Fixture sign-in over the live provider: what mints test accounts (`account Ro { … }`)
   against real InstantDB auth — the admin SDK in the test harness, and is that acceptable as a
   harness-only trusted lane?
10. The demo apps' pre-consolidation deltas (`public publish`, household-projection invites
    that lose the used-vs-mistyped distinction) — consolidated in Process step 3, but slice
    tests written now should use the decided forms.

## Deferred (running list — liked or acknowledged, not in this program's slices)

- Nuanced rule customization: negative grants, time-boxed grants, delegation ("may invite but
  not remove"), per-field _read_ scoping outside `publish`.
- Organizations, nested groups, roles beyond one enum per membership.
- Audit trails ("who changed this"), admin consoles, session/device management, sign-in
  revocation UX.
- Rate limiting and abuse controls on public capabilities (InstantDB exposes `rateLimit` in
  rules; not designed here).
- Additional providers (Firestore's materialized public records, Supabase RLS) — §4 names the
  patterns; this program proves one provider deeply rather than three shallowly.
- Presence visibility semantics (multiplayer program, consuming sharing semantics settled here).

## Direction settled

_(Accumulates from dialogue with Ro; dated entries, one ruling each. Nothing recorded yet.)_
