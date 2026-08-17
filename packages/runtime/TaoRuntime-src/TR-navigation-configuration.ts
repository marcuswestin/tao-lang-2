import type {
  TaoAppDeclaration,
  TaoConfiguredNavigation,
  TaoImplementedNavDeclaration,
  TaoNavDeclaration,
  TaoNavigationInput,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import type { Evaluable } from './TR-navigation-presentables'
import { registerNavigation } from './TR-navigation-registry'
import { RuntimeNavigationValue } from './TR-navigation-value'
import { isPresentable } from './TR-navigation-values'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'

export function createAppDeclaration(name: string): TaoAppDeclaration {
  return createNavDeclaration(name)
}

export function createNavDeclaration(name: string): TaoNavDeclaration {
  return Object.freeze({ identity: Symbol(name), name })
}

export function configureNavigation(
  declaration: TaoImplementedNavDeclaration,
  config: Record<string, unknown>,
): TaoConfiguredNavigation {
  let configured: TaoConfiguredNavigation
  configured = Object.freeze({
    config: freezeNavConfiguration(config),
    declaration,
    evaluate: () => configured,
  })
  return configured
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
): TaoNavigationValue {
  const kind = configured.declaration.kind
  const config = normalizeConfiguredNavigation(configured, registerMount)
  const descriptor = kind.configure(configured.declaration, config)
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
  if (!mounted) {
    throw new Error(
      `Cannot resolve configured navigation '${target.declaration.name}': it is not mounted in the enclosing app.`,
    )
  }
  return mounted
}

function normalizeConfiguredNavigation(
  configured: TaoConfiguredNavigation,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
): Record<string, unknown> {
  const config = configured.config
  if (configured.declaration.kind.profile === 'stack' || configured.declaration.kind.profile === 'slot') {
    return {
      initial: configuredPresentable(config['Initial'], configured.declaration.name, 'Initial', registerMount),
      name: configured.declaration.name,
    }
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
          ),
          ...(icon ? { icon } : {}),
          label: configuredEvaluable(item['Label'], configured.declaration.name, `@${key}.Label`),
        }]
      }),
  )
  return {
    display: configuredEvaluable(config['Display'], configured.declaration.name, 'Display'),
    initial: configuredKey(config['Initial'], configured.declaration.name, 'Initial'),
    items,
    name: configured.declaration.name,
  }
}

function configuredEvaluable(value: unknown, name: string, property: string): Evaluable {
  if (isPresentable(value) || !value || typeof (value as Evaluable).evaluate !== 'function') {
    throw new Error(`${name} configuration '${property}' expects a scalar Tao value.`)
  }
  return value as Evaluable
}

function configuredPresentable(
  value: unknown,
  name: string,
  property: string,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
): TaoPresentable | TaoNavigationValue {
  const mounted = isConfiguredNavigation(value) ? mountConfiguredNavigation(value, registerMount) : value
  if (!isPresentable(mounted)) {
    throw new Error(`${name} configuration '${property}' expects ui or nav.`)
  }
  return mounted
}

function configuredKey(value: unknown, name: string, property: string): string {
  const key = configuredEvaluable(value, name, property).evaluate().jsValue
  if (typeof key !== 'string' || !key.startsWith('@')) {
    throw new Error(`${name} configuration '${property}' expects an @key.`)
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
