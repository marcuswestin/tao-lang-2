# Plan — Auth and data pairing

Status: decided 2026-09-27; implementation started. The first target is the InstantDB datasource
signed in through Clerk and through InstantDB's own email-code auth, with no Tao-hosted server.
[Plan — Auth and account data](<Plan - Auth and account data.md>) remains the owner of the account
semantics this plan builds on; this plan owns how an auth provider and a datasource pair.

"Pairing" names the exchange between an auth provider and a datasource. The repository's word
"bridge" already means binding Tao code to a TypeScript value (`packages/AGENTS.md`), so it is not
used for this.

## Decisions

Settled with the Developer on 2026-09-27:

1. **Proof kinds.** An auth provider _issues_ sign-in proofs of three runtime-owned kinds, and a
   datasource _accepts_ kinds. A pairing works when they overlap. A datasource may restrict a kind
   to named providers with `from`.
   - a. `IdentityToken`: a signed token naming its issuer and subject (Clerk's session token).
   - b. `Session`: a provider's own session, usable only by a partner that names the provider
     (InstantAuth to InstantDB, LocalAuth to Reference).
   - c. `TestIdentity`: TestAuth fixtures, accepted only where test authority is declared.
2. **The data side resolves the Account.** After the auth provider signs in, the datasource that
   holds `Account` turns proofs into the application Account ID and owns any backend session the
   exchange creates. Auth providers no longer return account IDs or know datasource endpoints.
3. **Declarations live in `.tao`.** Provider types gain `issues { … }`, `accepts { … }`, and
   `supports { … }` blocks beside `provider … from`, so the compiler checks pairings and data
   features without running TypeScript.
4. **No email identity rule in the language.** Each auth provider decides whether email
   verification is required; unverified accounts allow guest and temporary accounts that work at
   once. A datasource that keys identity by email may refuse unverified proofs: the InstantDB
   datasource accepts a Clerk `IdentityToken` only when its email is verified, because InstantDB
   looks users up by email.
5. **The snapshot InstantDB adapter is replaced** by a per-row adapter, and WordFlower moves to it.
   The hosted demo's snapshot-shaped data is abandoned.

Defaults taken for the remaining inventory (vetoable):

- The datasource whose store holds `Account` owns it; other authenticated datasources receive its ID.
- The data side pulls fresh proofs when it needs them. Sign-out releases the datasource's session
  before the auth provider's, and retries a revocation it could not confirm.
- A datasource type without `supports` is an error; nothing is implied. The same blocks apply to
  app-authored datasources.
- Each app variant is checked separately; unsupported use is an error at the use and at the
  `Datasource` line. `access` rules without an `Auth` provider are a compile error.
- Every declared capability runs its own check in the provider conformance suite.
- Capabilities may take a level, starting with `Migrations Additive`.
- InstantDB's Account is an `accounts` row whose ID equals the InstantDB user ID, linked one-to-one
  to `$users`, so concurrent first logins write the same row.
- `AppId` appears on both the InstantAuth and InstantDB slots, and the pairing refuses a mismatch.
- An unauthenticated InstantDB app without `access` rules gets public permission rules and a
  compile warning that anyone with the app ID can read and write its data.
- Schema and permission rules are pushed through InstantDB's HTTP APIs with no new dependency.
  Generated schema and rule files are build output. This slice supports additive changes; renames
  and destructive changes are refused with an explanation.
- The demo runs on the Developer's existing Instant Cloud account, configured by hand until
  [`A19`](<../MVP Roadmap/Agent MVP Roadmap.md>) adds Tao CLI secrets and configuration.

## Declarations

```tao
type Clerk is AuthProvider with {
   PublishableKey text
   issues { IdentityToken }
   provider ClerkAuthProvider from ./Clerk.ts
}

type InstantAuth is AuthProvider with {
   AppId text
   issues { Session }
   provider InstantAuthProvider from ./InstantAuth.ts
}

type InstantDB is datasource with {
   AppId text
   accepts { IdentityToken from Clerk, Session from InstantAuth }
   supports { Relations, UniqueFields, AccessRules, FieldUpdates, Migrations Additive }
   provider InstantDBProvider from ./InstantDB.ts
}
```

The capability vocabulary is closed and owned by the compiler. Every name has one detector over app
source; a name without a detector is not in the vocabulary. A capability means the datasource
guarantees the feature for every writer, not only on one device. The initial list, confirmed or
trimmed by the language slice:

| Capability         | Detected from                                                   |
| ------------------ | --------------------------------------------------------------- |
| `Relations`        | relation fields and `(owned)` collections                       |
| `UniqueFields`     | `unique A`                                                      |
| `UniqueTogether`   | `unique A + B`                                                  |
| `AccessRules`      | any `access` block for data the datasource stores               |
| `FieldUpdates`     | `can update Field`                                              |
| `MembershipRules`  | access through a relation path (`Workspace.Memberships.Person`) |
| `Offline`          | an `Offline { … }` working set                                  |
| `Migrations Level` | a schema change against the last push (checked at push time)    |

## Runtime protocol

- `TaoAuthConnection` reports `SignedIn` with a principal (`issuer`, `subject`, optional `email` and
  `emailVerified`) and implements `proof(kind, signal)`. It no longer returns an account ID.
- The runtime stamps each proof with the auth declaration's name and refuses expired proofs or kinds
  the declaration does not issue.
- `TaoDataProvider.authenticate(context)` receives the principal and a proof source, and returns
  the account ID, a credential source for its own transport, and `release(signal)`.
- The public session stays `Authenticating` until the account datasource resolves the Account, so
  `SignedIn` still means the app can read account data. A failed resolution is `Error`.
- The pairing metadata the compiler emits replaces `authenticatedAuthority`.

## Sequence

1. **Runtime protocol**, moving TestAuth/Memory, LocalAuth/Reference, and Clerk/Reference onto it
   without behaviour change. The Clerk gateway exchange moves from the Clerk provider into Reference.
2. **Language**: grammar, validation, formatting, and emission of `issues`, `accepts`, and `supports`;
   capability detectors; pairing and `access`-without-`Auth` diagnostics; declarations on every
   standard provider.
3. **Per-row InstantDB datasource**: one InstantDB entity per row, links for relations, schema and
   permission generation from the compiled data catalogue and policy, and an HTTP push client, all
   inside `tao-instantdb` where Authority.md places the diffing layer. Proven unauthenticated first.
4. **InstantAuth** (email code, then guest) and InstantDB's `authenticate` for
   `Session from InstantAuth` and `IdentityToken from Clerk`, over one shared InstantDB client per
   app ID.
5. **Push command and apps**: a `tao` command pushing schema and rules to local InstantDB for tests;
   `AuthReviewInstant` and `AuthReviewInstantClerk` variants with Tao journeys against local
   InstantDB; WordFlower moved to the per-row adapter.
6. **Hosted demo**: the Developer's Instant Cloud app with the Clerk client registered and rules
   pushed; browser and phone acceptance.

## Acceptance

- Existing Auth Review journeys pass unchanged on TestAuth/Memory, LocalAuth/Reference, and
  Clerk/Reference after step 1.
- Compile errors for an unpaired Auth/Datasource, a capability the datasource lacks, and `access`
  without `Auth`, each naming the use and the `Datasource` line.
- Against local InstantDB: registration, owned-note persistence, relaunch restoration, sign-out
  isolation, and denied cross-account reads and writes checked through admin queries, for both
  InstantAuth and Clerk.
- Hosted: the same journey on the Developer's Instant Cloud app, then on a phone.

## Developer actions for the hosted demo

- Choose or create the Instant Cloud app and store its app ID and admin token in the repository
  secret store.
- In Clerk, add `email` and `email_verified` claims to the session token; register the Clerk
  publishable key as an InstantDB auth client.
