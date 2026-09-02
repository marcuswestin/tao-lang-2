import type { Evaluable } from './TR-navigation-presentables'

/** TaoCommandFills are the slot values one binding supplied, keyed by slot name. */
export type TaoCommandFills = Readonly<Record<string, Evaluable>>

/** TaoCommandAction is the action value a command runs once its slots carry values. */
type TaoCommandAction = {
  evaluate(): {
    jsValue: {
      invoke(...arguments_: Evaluable[]): unknown
      invokeJoined?(...arguments_: Evaluable[]): void | Promise<void>
    }
  }
}

/**
 * A command is one action invocation plus the words a person reads, written as functions of the
 * slots it still needs. Keeping every member a function of the fills is what lets one declaration
 * serve every binding of it without re-evaluating anything a binding did not change.
 */
export type TaoCommandDefinition = {
  action: (fills: TaoCommandFills) => TaoCommandAction
  arguments?: (fills: TaoCommandFills) => readonly Evaluable[]
  members?: Readonly<Record<string, (fills: TaoCommandFills) => Evaluable | undefined>>
  name: string
  slots?: readonly string[]
}

/** TaoCommandSnapshot is one command as a host surface reads it. */
export type TaoCommandSnapshot = Readonly<{
  enabled: boolean
  icon?: string
  identity: string
  key: string
  label: string
  invoke(): unknown
}>

/** TaoCommandMembers are the member readings one declaration or one binding of it supplies. */
export type TaoCommandMembers = Readonly<
  Record<string, (fills: TaoCommandFills) => Evaluable | undefined>
>

/**
 * A command's declaration may arrive as a thunk. A configured navigator lists commands where it is
 * declared, which can be above the commands themselves, so the list holds the name and reads the
 * declaration the first time anything asks.
 */
export type TaoCommandSource = TaoCommandDefinition | (() => TaoCommandDefinition)

/** RuntimeCommand keeps a command's declaration and the fills one binding of it supplied. */
export class RuntimeCommand {
  readonly jsValue: Readonly<{
    invoke(): unknown
    invokeJoined(): void | Promise<void>
  }>

  #resolved: TaoCommandDefinition | undefined

  constructor(
    private readonly source: TaoCommandSource,
    private readonly fills: TaoCommandFills = {},
    private readonly overrides: TaoCommandMembers = {},
  ) {
    this.jsValue = Object.freeze({
      invoke: () => this.run(false),
      invokeJoined: () => this.run(true) as void | Promise<void>,
    })
  }

  /** declaration reads the definition this command was made from, resolving a deferred one. */
  declaration(): TaoCommandDefinition {
    this.#resolved ??= typeof this.source === 'function' ? this.source() : this.source
    return this.#resolved
  }

  /** name is the declared identity of the command, which every binding of it shares. */
  get name(): string {
    return this.declaration().name
  }

  /** slots names every value this command needs before it can run. */
  get slots(): readonly string[] {
    return this.declaration().slots ?? []
  }

  /** unfilledSlots reports what a binding still owes, which is what makes a command offerable. */
  unfilledSlots(): readonly string[] {
    return this.slots.filter(slot => this.fills[slot] === undefined)
  }

  evaluate(): this {
    return this
  }

  /** with derives a bound command: same declaration, more of its slots and words settled. */
  with(fills: TaoCommandFills = {}, members: TaoCommandMembers = {}): RuntimeCommand {
    return new RuntimeCommand(
      this.source,
      Object.freeze({ ...this.fills, ...fills }),
      Object.freeze({ ...this.overrides, ...members }),
    )
  }

  /** read renders the command as a host surface sees it right now. */
  read(): TaoCommandSnapshot {
    const icon = textMember(this.member('Icon'))
    const label = textMember(this.member('Label')) ?? textMember(this.member('Title')) ?? this.name
    return Object.freeze({
      enabled: booleanMember(this.member('Enabled'), true),
      ...(icon ? { icon } : {}),
      identity: this.name,
      key: textMember(this.member('Key')) ?? this.name,
      label,
      invoke: this.jsValue.invoke,
    })
  }

  /** member evaluates one member of this command, preferring what this binding refined. */
  member(name: string): Evaluable | undefined {
    const reading = this.overrides[name] ?? this.declaration().members?.[name]
    return reading?.(this.fills)
  }

  private run(joined: boolean): unknown {
    const declaration = this.declaration()
    const value = declaration.action(this.fills).evaluate().jsValue
    const arguments_ = declaration.arguments?.(this.fills) ?? []
    return joined && value.invokeJoined
      ? value.invokeJoined(...arguments_)
      : value.invoke(...arguments_)
  }
}

function textMember(value: Evaluable | undefined): string | undefined {
  const jsValue = value?.evaluate().jsValue
  return typeof jsValue === 'string' && jsValue.length > 0 ? jsValue : undefined
}

function booleanMember(value: Evaluable | undefined, fallback: boolean): boolean {
  const jsValue = value?.evaluate().jsValue
  return typeof jsValue === 'boolean' ? jsValue : fallback
}

/** InteractionControls is the handwritten surface generated modules reach for their commands. */
export const CommandControls = {
  /** Command creates one declared command value. */
  Command(definition: TaoCommandDefinition): RuntimeCommand {
    return new RuntimeCommand(definition)
  },

  /** Deferred names a command declared elsewhere in its module, read the first time it is used. */
  Deferred(resolve: () => RuntimeCommand): RuntimeCommand {
    return new RuntimeCommand(() => resolve().declaration())
  },

  /** Bind derives a command with more of its slots filled and its words refined. */
  Bind(command: RuntimeCommand, fills: TaoCommandFills = {}, members: TaoCommandMembers = {}): RuntimeCommand {
    return command.with(fills, members)
  },
} as const
