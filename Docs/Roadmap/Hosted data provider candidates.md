# Hosted data provider candidates

The slice after provider pairing lands: evaluate hosted data and auth services as Tao providers,
sort them into Tier 1 and Not now, and implement the Tier 1 providers where the evaluation finds a
fit. The Developer set this direction on 2026-09-27.

Instant Cloud closed new signups and shuts down on 2027-08-31 ([Plan — Auth and data
pairing](<Plan - Auth and data pairing.md>)), so Tao needs hosted providers besides InstantDB.

## Candidates

Listed in the Developer's expected order of relevance, highest first. Nothing here has been
evaluated yet; the evaluation moves each row to Tier 1 or Not now and records why.

| Candidate | Tier        | Notes                                                                                                                                                       |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jazz      | Unevaluated |                                                                                                                                                             |
| Pylon     | Unevaluated |                                                                                                                                                             |
| Zero      | Unevaluated |                                                                                                                                                             |
| PowerSync | Unevaluated | Already assessed as a strong fit for explicit offline subsets in [Plan — Auth and account data](<Plan - Auth and account data.md>), before pairing existed. |
| Convex    | Unevaluated |                                                                                                                                                             |
| LiveStore | Unevaluated |                                                                                                                                                             |
| Electric  | Unevaluated |                                                                                                                                                             |
| Ditto     | Unevaluated |                                                                                                                                                             |
| Automerge | Unevaluated |                                                                                                                                                             |
| RxDB      | Unevaluated | Possible; lowest priority.                                                                                                                                  |

## What the evaluation decides for each candidate

1. Whether it can be a datasource provider, an auth provider, or both, and which sign-in proofs it
   would issue or accept under the pairing protocol (`issues` and `accepts`).
2. Which data capabilities it can honestly declare (`supports`), and what Tao's conformance suite
   would need to prove for each.
3. Whether an app can run against it with no server Tao or the app author hosts, which is the bar
   InstantDB met.
4. React Native and Expo support, offline behavior, and how a client authenticates.
5. Maturity, licensing, pricing, and self-hosting, and whether a dependency is needed. A new
   dependency needs the Developer's approval.

Tier 1 means a great fit worth implementing now. Not now keeps the candidate listed with the reason,
so a later pass can revisit it.

## Sequence

1. Research every candidate from its current primary documentation, delegated to a research agent,
   and fill in the table with sources and dates.
2. Record the tiers, and ask the Developer to approve each SDK dependency a Tier 1 provider needs.
3. Implement Tier 1 providers one per slice, each with its pairing declarations, conformance
   checks, and an Auth Review journey, as InstantDB and InstantAuth were.
