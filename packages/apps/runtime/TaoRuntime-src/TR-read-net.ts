import type React from 'react'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'
import { Views } from './TR-views'

/**
 * The read net is the handling every render guard falls back on for the exceptional read cases it
 * does not name. The runtime always supplies it; an app's guard replaces it case by
 * case. Emptiness is content rather than failure, so no case here is ever `empty`.
 */
const readNetCases = ['loading', 'missing', 'unauthorized', 'error'] as const

/** One exceptional read case the net handles. */
export type TaoReadNetCase = typeof readNetCases[number]
/** `none` is the source-facing name for a missing live entity handle. */
type TaoReadCase = TaoReadNetCase | 'none'

/** Optional facts the compiler can prove about the expression at a guard site. */
export type TaoReadHint = Readonly<{
  readKind?: 'account' | 'entity' | 'query' | 'reference' | 'unknown'
  subjectLabel?: string
  subjectType?: string
}>

/** Public, provider-neutral facts passed to an exceptional read handler. */
export type TaoReadContext = Readonly<{
  Case: TaoReadCase
  State: TaoReadNetCase
  Message: string
  ReadKind: NonNullable<TaoReadHint['readKind']>
  SubjectLabel?: string
  SubjectType?: string
  LoadingPhase?: 'initial' | 'refresh'
  ElapsedSeconds?: number
  ProgressCompleted?: number
  ProgressTotal?: number
  MissingReason?: 'not-found' | 'unresolved-reference'
  UnauthorizedReason?: 'signed-out' | 'access-denied'
  Recovery?: () => void | Promise<void>
  ErrorCategory?: string
  Retryable?: boolean
  Retry?: () => void | Promise<void>
}>

const runtimeMessages: Record<TaoReadNetCase, string> = {
  loading: 'Loading this item.',
  missing: 'This item could not be found.',
  unauthorized: "You don't have access to this item.",
  error: 'Unable to load this item.',
}

const queryMessages: Record<TaoReadNetCase, string> = {
  loading: 'Loading items.',
  missing: 'These items could not be found.',
  unauthorized: "You don't have access to these items.",
  error: 'Unable to load these items.',
}

function readMessage(
  state: TaoReadNetCase,
  hint: TaoReadHint,
  facts: Readonly<Partial<Pick<TaoReadContext, 'MissingReason' | 'UnauthorizedReason'>>>,
): string {
  const label = hint.subjectLabel?.trim()
  const type = hint.subjectType?.trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
  const subject = label || (type ? `this ${type}` : undefined)
  if (state === 'unauthorized' && facts.UnauthorizedReason === 'signed-out') {
    return `Sign in to view ${subject ?? 'this item'}.`
  }
  if (state === 'missing' && facts.MissingReason === 'unresolved-reference') {
    return subject ? `Could not resolve the link to ${subject}.` : 'Could not resolve this link.'
  }
  if (!subject) {
    return (hint.readKind === 'query' ? queryMessages : runtimeMessages)[state]
  }
  if (state === 'loading') {
    return `Loading ${subject}.`
  }
  if (state === 'missing') {
    return `${label ? subject : `This ${type}`} could not be found.`
  }
  if (state === 'unauthorized') {
    return `You don't have access to ${subject}.`
  }
  return `Could not load ${subject}.`
}

/** Keep provider diagnostics out of both local and app-authored read handlers. */
export function readContext(
  state: TaoReadNetCase,
  hint: TaoReadHint = {},
  facts: Readonly<Partial<Pick<TaoReadContext, 'ElapsedSeconds' | 'MissingReason' | 'UnauthorizedReason'>>> = {},
  selectedCase: TaoReadCase = state,
): TaoReadContext {
  // TODO: Docs/Roadmap/Tao Revolution/Follow-ups - Read context producers.md tracks proven
  // elapsed time, progress, recovery, category, and retry producers. Do not invent a capability or no-op action.
  return Object.freeze({
    Case: selectedCase,
    State: state,
    Message: readMessage(state, hint, facts),
    ReadKind: hint.readKind ?? 'unknown',
    SubjectLabel: hint.subjectLabel,
    SubjectType: hint.subjectType,
    LoadingPhase: state === 'loading' ? 'initial' : undefined,
    ElapsedSeconds: facts.ElapsedSeconds,
    ProgressCompleted: undefined,
    ProgressTotal: undefined,
    MissingReason: facts.MissingReason,
    UnauthorizedReason: facts.UnauthorizedReason,
    Recovery: undefined,
    ErrorCategory: undefined,
    Retryable: undefined,
    Retry: undefined,
  })
}

/**
 * One app guard handler. It renders at the guard that reached the net, as that guard's own
 * branch would, so it receives the guarding view's props and a safe read context.
 */
type TaoReadNetHandler = (
  siteProps: { __tao?: TaoProps },
  context: { evaluate(): { jsValue: TaoReadContext } },
) => React.ReactNode

/** An app guard: the cases it replaces. Every case it omits keeps the runtime's. */
export type TaoReadNet = Readonly<Partial<Record<TaoReadCase, TaoReadNetHandler>>>

/** ReadNet freezes the handlers a compiled app guard declares. */
export function ReadNet(handlers: TaoReadNet): TaoReadNet {
  return Object.freeze({ ...handlers })
}

/** Merge an inherited app net with this variant's own cases. */
export function MergeReadNet(base: TaoReadNet | undefined, own: TaoReadNet): TaoReadNet {
  return ReadNet({ ...base, ...own })
}

/**
 * renderReadNet renders one exceptional case through the mounted app's guard, or through
 * the runtime's own handling when the app declares none for that case.
 */
export function renderReadNet(
  caseName: TaoReadNetCase,
  context: { evaluate(): { jsValue: TaoReadContext } },
  siteProps: TaoProps | undefined,
): React.ReactNode {
  const handlers = TaoPropsControls.appInChain(siteProps)?.readNet
  const override = caseName === 'missing' ? handlers?.none ?? handlers?.missing : handlers?.[caseName]
  if (override) {
    return override({ __tao: siteProps }, context)
  }
  return runtimeReadNet(caseName, context.evaluate().jsValue, siteProps)
}

/**
 * The runtime's net speaks plainly, in the app's own `Spinner` and `Text` element defaults.
 */
function runtimeReadNet(
  caseName: TaoReadNetCase,
  context: TaoReadContext,
  siteProps: TaoProps | undefined,
): React.ReactNode {
  const ambient = TaoPropsControls.ambientContext(siteProps)
  if (caseName === 'loading') {
    return Views.View({
      children: [
        Views.Spinner({ label: context.Message }, { ...ambient, designDefault: 'Spinner' }),
        Views.Text({ children: [context.Message] }, { ...ambient, designDefault: 'Text' }),
      ],
    }, { ...ambient, designDefault: 'View' })
  }
  return Views.Text({ children: [context.Message] }, { ...ambient, designDefault: 'Text' })
}
