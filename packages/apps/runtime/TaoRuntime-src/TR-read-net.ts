import type React from 'react'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'
import { Views } from './TR-views'

/**
 * The read net is the handling every render guard falls back on for the exceptional read cases it
 * does not name. The runtime always supplies it; a project's `guard default` replaces it case by
 * case. Emptiness is content rather than failure, so no case here is ever `empty`.
 */
export const readNetCases = ['loading', 'missing', 'unauthorized', 'error'] as const

/** One exceptional read case the net handles. */
export type TaoReadNetCase = typeof readNetCases[number]

/**
 * One `guard default` handler. It renders at the guard that reached the net, as that guard's own
 * branch would, so it receives the guarding view's props; `error` also receives its message.
 */
type TaoReadNetHandler = (
  siteProps: { __tao?: TaoProps },
  message: { evaluate(): { jsValue: unknown } },
) => React.ReactNode

/** A project's `guard default`: the cases it replaces. Every case it omits keeps the runtime's. */
export type TaoReadNet = Readonly<Partial<Record<TaoReadNetCase, TaoReadNetHandler>>>

/** ReadNet freezes the handlers a compiled `guard default` declares. */
export function ReadNet(handlers: TaoReadNet): TaoReadNet {
  return Object.freeze({ ...handlers })
}

/**
 * renderReadNet renders one exceptional case through the mounted app's `guard default`, or through
 * the runtime's own handling when the app declares none for that case.
 */
export function renderReadNet(
  caseName: TaoReadNetCase,
  message: { evaluate(): { jsValue: unknown } },
  siteProps: TaoProps | undefined,
): React.ReactNode {
  const override = TaoPropsControls.appInChain(siteProps)?.readNet?.[caseName]
  if (override) {
    return override({ __tao: siteProps }, message)
  }
  return runtimeReadNet(caseName, message, siteProps)
}

/**
 * The runtime's net speaks plainly, in the app's own `Spinner` and `Text` element defaults. An error
 * shows its own message, which the data layer always supplies.
 */
const runtimeSentences = {
  missing: 'This is gone',
  unauthorized: "You don't have access to this",
} as const satisfies Record<Exclude<TaoReadNetCase, 'loading' | 'error'>, string>

function runtimeReadNet(
  caseName: TaoReadNetCase,
  message: { evaluate(): { jsValue: unknown } },
  siteProps: TaoProps | undefined,
): React.ReactNode {
  const ambient = TaoPropsControls.ambientContext(siteProps)
  if (caseName === 'loading') {
    return Views.Spinner({}, { ...ambient, designDefault: 'Spinner' })
  }
  const sentence = caseName === 'error' ? String(message.evaluate().jsValue) : runtimeSentences[caseName]
  return Views.Text({ children: [sentence] }, { ...ambient, designDefault: 'Text' })
}
