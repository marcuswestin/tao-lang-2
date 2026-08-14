type BackTarget = {
  back(): boolean
}

type Resettable = {
  reset(): void
}

const navigationValues = new Set<Resettable>()
const appDefinitions = new Set<Resettable>()
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
