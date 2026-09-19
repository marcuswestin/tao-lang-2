import { Errors } from '@shared/core'

/**
 * StudioMessages is the one dispatch shape for every wire message Studio receives — the session
 * event socket, the device gateway, and the preview window all route through it. The handler table
 * is keyed by the message union's own `type`, so adding a message to a protocol fails to compile
 * until every receiver handles it, and a receiver that deliberately ignores one says so with
 * `StudioMessages.ignore` rather than by falling off the end of a chain.
 */

/** One member of a message union: an object discriminated by a literal `type`. */
export type StudioTypedMessage = { type: string }

/** One handler per member of a message union, keyed by that member's `type`. */
export type StudioMessageHandlers<MessageT extends StudioTypedMessage, ResultT = void> = {
  [TypeT in MessageT['type']]: (message: Extract<MessageT, { type: TypeT }>) => ResultT
}

export const StudioMessages = {
  /** dispatch routes one message to its handler; a union member with no handler is a type error. */
  dispatch<MessageT extends StudioTypedMessage, ResultT = void>(
    message: MessageT,
    handlers: StudioMessageHandlers<MessageT, ResultT>,
  ): ResultT {
    // Own keys only: `type` arrives off a socket, and `constructor` must not resolve to `Object`.
    const handler = Object.hasOwn(handlers, message.type)
      ? handlers[message.type as MessageT['type']] as (message: MessageT) => ResultT
      : undefined
    if (handler === undefined) {
      Errors.throwUnexpected(`Studio received an unknown message: ${JSON.stringify(message)}`)
    }
    return handler(message)
  },
  /** ignore is the handler for a message this receiver has nothing to do with. */
  ignore(): void {},
} as const
