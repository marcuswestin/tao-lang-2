type BackTarget = {
  back(): boolean
}

type Resettable = {
  reset(): void
}

type RegisteredPresentable = {
  definition: {
    identity?: { canonical: string }
    name: string
  }
}

const navigationValues = new Set<Resettable>()
const appDefinitions = new Set<Resettable>()
type VersionedPresentable = {
  presentable: RegisteredPresentable
  version: number
}

const presentablesByIdentity = new Map<string, VersionedPresentable[]>()
let presentableVersion = 0
let activeBackTarget: BackTarget | undefined

export function backNavigation(target?: BackTarget): boolean {
  return (target ?? activeBackTarget)?.back() ?? false
}

export function clearActiveBackTarget(target: BackTarget): void {
  if (activeBackTarget === target) {
    activeBackTarget = undefined
  }
}

export function registerNavigation<ValueT extends Resettable>(navigation: ValueT): ValueT {
  navigationValues.add(navigation)
  return navigation
}

export function registerNavigationApp<AppT extends Resettable>(app: AppT): AppT {
  appDefinitions.add(app)
  return app
}

export function registerPresentable<PresentableT extends RegisteredPresentable>(
  presentable: PresentableT,
): PresentableT {
  const identity = presentable.definition.identity
  if (!identity) {
    return presentable
  }
  const registrations = presentablesByIdentity.get(identity.canonical) ?? []
  const existing = registrations.at(-1)?.presentable
  if (existing && existing.definition.name !== presentable.definition.name) {
    throw new Error(
      `Canonical declaration identity collision between '${existing.definition.name}' and '${presentable.definition.name}'.`,
    )
  }
  // Keep every module evaluation. An app resolves against the registry version visible when its
  // definition was created, so a later test bundle or Fast Refresh cannot lend it a foreign closure.
  registrations.push({ presentable, version: ++presentableVersion })
  presentablesByIdentity.set(identity.canonical, registrations)
  return presentable
}

export function resolvePresentable<PresentableT extends RegisteredPresentable>(
  canonicalIdentity: string,
  maximumVersion = presentableVersion,
): PresentableT {
  const registrations = presentablesByIdentity.get(canonicalIdentity)
  const registration = registrations?.findLast(candidate => candidate.version <= maximumVersion)
  if (!registration) {
    throw new Error(`No registered Tao view has canonical identity ${canonicalIdentity}.`)
  }
  return registration.presentable as PresentableT
}

/** presentableRegistryVersion captures the module registrations visible to a new app definition. */
export function presentableRegistryVersion(): number {
  return presentableVersion
}

export function resetNavigationRuntime(): void {
  activeBackTarget = undefined
  for (const navigation of navigationValues) {
    navigation.reset()
  }
  for (const app of appDefinitions) {
    app.reset()
  }
}

export function setActiveBackTarget(target: BackTarget): void {
  activeBackTarget = target
}
