import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
import { RuntimeCommand } from './TR-interaction'
import type {
  TaoAppDeclaration,
  TaoConfiguredNavigation,
  TaoImplementedNavDeclaration,
  TaoNavDeclaration,
  TaoNavigationInput,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import { canonicalDescriptor, type TaoDeclarationIdentity } from './TR-navigation-identity'
import type { Evaluable } from './TR-navigation-presentables'
import { registerNavigation } from './TR-navigation-registry'
import { RuntimeNavigationValue } from './TR-navigation-value'
import { isPresentable } from './TR-navigation-values'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'

export function createAppDeclaration(name: string, identity?: TaoDeclarationIdentity): TaoAppDeclaration {
  return createNavDeclaration(name, identity)
}

export function createNavDeclaration(name: string, canonicalIdentity?: TaoDeclarationIdentity): TaoNavDeclaration {
  return Object.freeze({ ...(canonicalIdentity ? { canonicalIdentity } : {}), identity: Symbol(name), name })
}

export function configureNavigation(
  declaration: TaoImplementedNavDeclaration,
  config: Record<string, unknown>,
): TaoConfiguredNavigation {
  let configured: TaoConfiguredNavigation
  configured = Object.freeze({
    ...(declaration.canonicalIdentity
      ? {
        canonicalDescriptor: canonicalDescriptor(
          declaration.canonicalIdentity,
          restorableNavigationConfiguration(declaration, config),
        ),
      }
      : {}),
    config: freezeNavConfiguration(config),
    declaration,
    evaluate: () => configured,
  })
  return configured
}

function restorableNavigationConfiguration(
  declaration: TaoImplementedNavDeclaration,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const hostSlots = new Set<string>(declaration.kind.hostSlots?.reads ?? [])
  hostSlots.add('__taoHostSlots')
  return Object.fromEntries(Object.entries(config).filter(([name]) => !hostSlots.has(name)))
}

export function freezeNavConfiguration<ConfigurationT extends object>(
  config: ConfigurationT,
): Readonly<ConfigurationT> {
  return freezePlainNavValue(config)
}

export function isConfiguredNavigation(value: unknown): value is TaoConfiguredNavigation {
  return typeof value === 'object' && value !== null
    && 'declaration' in value && 'config' in value && 'evaluate' in value
}

export function mountConfiguredNavigation(
  configured: TaoConfiguredNavigation,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
  resolvePresentable?: (presentable: TaoPresentable) => TaoPresentable,
): TaoNavigationValue {
  const kind = configured.declaration.kind
  const config = normalizeConfiguredNavigation(configured, registerMount, resolvePresentable)
  const configuredDescriptor = kind.configure(configured.declaration, config)
  const descriptor = configured.canonicalDescriptor
    ? Object.freeze({ ...configuredDescriptor, canonicalDescriptor: configured.canonicalDescriptor })
    : configuredDescriptor
  const mount = registerNavigation(kind.mount(descriptor) as RuntimeNavigationValue)
  registerMount?.(configured, mount)
  return mount
}

export function resolveNavigationTarget(
  taoProps: TaoProps | undefined,
  target: TaoNavigationInput | undefined,
): TaoNavigationValue | undefined {
  if (!target) {
    return TaoPropsControls.navigationInChain(taoProps)
  }
  if (!isConfiguredNavigation(target)) {
    return target
  }
  const app = TaoPropsControls.appInChain(taoProps)
  const mounted = app?.resolve(target)
  RuntimeAssert.input(
    mounted,
    `Cannot resolve configured navigation '${target.declaration.name}': it is not mounted in the enclosing app.`,
    { navigation: target.declaration.name },
  )
  return mounted
}

function normalizeConfiguredNavigation(
  configured: TaoConfiguredNavigation,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
  resolvePresentable?: (presentable: TaoPresentable) => TaoPresentable,
): Record<string, unknown> {
  const config = configured.config
  if (configured.declaration.kind.profile === 'stack' || configured.declaration.kind.profile === 'slot') {
    return {
      ...normalizedHostSlots(configured),
      initial: configuredPresentable(
        config['Initial'],
        configured.declaration.name,
        'Initial',
        registerMount,
        resolvePresentable,
      ),
      name: configured.declaration.name,
    }
  }
  if (configured.declaration.kind.profile === 'split') {
    const items = Object.fromEntries(
      Object.entries(config)
        .filter(([key, value]) => key.startsWith('@') && isPlainRecord(value))
        .map(([sourceKey, value]) => {
          const key = sourceKey.slice(1)
          const item = value as Record<string, unknown>
          return [key, {
            content: configuredPresentable(
              item['Content'],
              configured.declaration.name,
              `@${key}.Content`,
              registerMount,
              resolvePresentable,
            ),
            resizable: configuredEvaluable(item['Resizable'], configured.declaration.name, `@${key}.Resizable`),
            width: configuredEvaluable(item['Width'], configured.declaration.name, `@${key}.Width`),
          }]
        }),
    )
    return { items, name: configured.declaration.name }
  }
  // The frame branch must precede the block below: that block is an unguarded fallthrough to the
  // selection shape, so an unrecognized profile is normalized as a SelectionNav and throws on the
  // Display it never configured.
  if (configured.declaration.kind.profile === 'frame') {
    const items = Object.fromEntries(
      Object.entries(config)
        .filter(([key, value]) => key.startsWith('@') && isPlainRecord(value))
        .map(([sourceKey, value]) => {
          const key = sourceKey.slice(1)
          const item = value as Record<string, unknown>
          const content = configuredFrameContent(
            item['Content'],
            configured.declaration.name,
            `@${key}.Content`,
            registerMount,
            resolvePresentable,
          )
          const size = item['Size'] === undefined
            ? undefined
            : configuredEvaluable(item['Size'], configured.declaration.name, `@${key}.Size`)
          return [key, {
            ...(content ? { content } : {}),
            label: configuredEvaluable(item['Label'], configured.declaration.name, `@${key}.Label`),
            ...(size ? { size } : {}),
          }]
        }),
    )
    return { items, name: configured.declaration.name }
  }
  const items = Object.fromEntries(
    Object.entries(config)
      .filter(([key, value]) => key.startsWith('@') && isPlainRecord(value))
      .map(([sourceKey, value]) => {
        const key = sourceKey.slice(1)
        const item = value as Record<string, unknown>
        const icon = item['Icon'] === undefined
          ? undefined
          : configuredEvaluable(item['Icon'], configured.declaration.name, `@${key}.Icon`)
        return [key, {
          content: configuredPresentable(
            item['Content'],
            configured.declaration.name,
            `@${key}.Content`,
            registerMount,
            resolvePresentable,
          ),
          ...(icon ? { icon } : {}),
          label: configuredEvaluable(item['Label'], configured.declaration.name, `@${key}.Label`),
        }]
      }),
  )
  return {
    ...normalizedHostSlots(configured),
    display: configuredEvaluable(config['Display'], configured.declaration.name, 'Display'),
    initial: configuredKey(config['Initial'], configured.declaration.name, 'Initial'),
    items,
    name: configured.declaration.name,
  }
}

function normalizedHostSlots(configured: TaoConfiguredNavigation): Record<string, unknown> {
  const supplied = configured.config['__taoHostSlots']
  const reads = configured.declaration.kind.hostSlots?.reads ?? []
  const values = isPlainRecord(supplied)
    ? supplied
    : Object.fromEntries(reads.map(name => [name, configured.config[name]]))
  const entries = Object.entries(values).flatMap(([name, value]) => {
    if (value && typeof (value as Evaluable).evaluate === 'function') {
      return [[name, value] as const]
    }
    if (Array.isArray(value) && value.every(item => item instanceof RuntimeCommand)) {
      return [[name, Object.freeze([...value])] as const]
    }
    return []
  })
  return { hostSlots: Object.freeze(Object.fromEntries(entries)) }
}

function configuredEvaluable(value: unknown, name: string, property: string): Evaluable {
  RuntimeAssert.input(
    !isPresentable(value) && value && typeof (value as Evaluable).evaluate === 'function',
    `${name} configuration '${property}' expects a scalar Tao value.`,
    { name, property },
  )
  return value as Evaluable
}

function configuredPresentable(
  value: unknown,
  name: string,
  property: string,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
  resolvePresentable?: (presentable: TaoPresentable) => TaoPresentable,
): TaoPresentable | TaoNavigationValue {
  const mounted = isConfiguredNavigation(value)
    ? mountConfiguredNavigation(value, registerMount, resolvePresentable)
    : value
  if (!isPresentable(mounted)) {
    throw new UserInputError(`${name} configuration '${property}' expects ui or nav.`, { name, property })
  }
  return mounted.kind === 'view' && resolvePresentable ? resolvePresentable(mounted) : mounted
}

/**
 * configuredFrameContent keeps a frame slot's Content as the configured expression.
 *
 * `configuredPresentable` above throws on absence, which is exactly the case a frame slot must
 * accept: `Content view is none` is the declared default, so an unfilled slot arrives as a Tao
 * value that evaluates to absence. The frame reads that value on every render, which makes the
 * empty-slot rule semantic and reactive rather than measured.
 */
function configuredFrameContent(
  value: unknown,
  name: string,
  property: string,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
  resolvePresentable?: (presentable: TaoPresentable) => TaoPresentable,
): TaoPresentable | TaoNavigationValue | Evaluable | undefined {
  if (value === undefined) {
    return undefined
  }
  const mounted = isConfiguredNavigation(value)
    ? mountConfiguredNavigation(value, registerMount, resolvePresentable)
    : value
  if (isPresentable(mounted)) {
    return mounted.kind === 'view' && resolvePresentable ? resolvePresentable(mounted) : mounted
  }
  if (mounted && typeof (mounted as Evaluable).evaluate === 'function') {
    return mounted as Evaluable
  }
  throw new UserInputError(`${name} configuration '${property}' expects ui, nav, or none.`, { name, property })
}

function configuredKey(value: unknown, name: string, property: string): string {
  const key = configuredEvaluable(value, name, property).evaluate().jsValue
  if (typeof key !== 'string' || !key.startsWith('@')) {
    throw new UserInputError(`${name} configuration '${property}' expects an @key.`, { name, property })
  }
  return key.slice(1)
}

function freezePlainNavValue<ValueT>(value: ValueT): ValueT {
  // Nested descriptors are declaration identities, not plain configuration records to clone.
  if (isConfiguredNavigation(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => freezePlainNavValue(item))) as ValueT
  }
  if (isPlainRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezePlainNavValue(item)]),
    )) as ValueT
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}
