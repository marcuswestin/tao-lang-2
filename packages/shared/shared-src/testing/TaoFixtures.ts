/** tsFence opens an embedded TypeScript block in Tao fixture source. */
export const tsFence = '```ts'

/** fence closes an embedded code block in Tao fixture source. */
export const fence = '```'

/** app wraps a MainView body in the standard standalone Tao app fixture. */
export function app(body: string, extra = ''): string {
  return `
    app MyApp { view MainView }
    view MainView { ${body} }
    ${extra}
  `
}

/** stubView returns a renderable Tao view fixture with an injected no-op implementation. */
export function stubView(name: string, parameters = ''): string {
  const declaration = parameters.length === 0 ? name : `${name} ${parameters}`
  return `
    view ${declaration} {
      render inject ${tsFence}
        return null
      ${fence}
    }
  `
}

/** stubLayout returns a renderable Tao layout fixture with an injected no-op implementation. */
export function stubLayout(name: string, parameters = ''): string {
  const declaration = parameters.length === 0 ? name : `${name} ${parameters}`
  return `
    layout ${declaration} {
      render inject ${tsFence}
        return null
      ${fence}
    }
  `
}
