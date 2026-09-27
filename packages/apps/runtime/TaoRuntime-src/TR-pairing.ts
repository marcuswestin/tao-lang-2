/**
 * Pairing metadata the compiler emits from a provider type's `issues`, `accepts`, and `supports`
 * blocks. An auth provider issues sign-in proofs of runtime-owned kinds; a datasource accepts kinds,
 * optionally only from named auth declarations, and lists the data capabilities it guarantees. The
 * compiler rejects an app whose Auth and Datasource cannot pair; the runtime repeats the pairing
 * check whenever it chooses the datasource to resolve the signed-in Account, so hand-written or stale
 * generated code cannot skip it.
 */

/** TaoAuthProofKind is the closed set of sign-in proof kinds an auth provider can issue. */
export type TaoAuthProofKind = 'IdentityToken' | 'Session' | 'TestIdentity'

/** TaoAuthPairing is what an auth declaration issues. */
export type TaoAuthPairing = Readonly<{ issues: readonly TaoAuthProofKind[] }>

/** TaoDataAcceptance is one accepted kind; `from` names an auth declaration the kind must come from. */
export type TaoDataAcceptance = Readonly<{ kind: TaoAuthProofKind; from?: string }>

/** TaoDataCapability is one declared data capability, with its level where the capability has levels. */
export type TaoDataCapability = Readonly<{ capability: string; level?: string }>

/** TaoDataPairing is what a datasource declaration accepts and supports. */
export type TaoDataPairing = Readonly<{
  accepts: readonly TaoDataAcceptance[]
  supports: readonly TaoDataCapability[]
}>
