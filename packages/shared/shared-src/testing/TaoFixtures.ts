/** tsFence opens an embedded TypeScript block in Tao fixture source. */
export const tsFence = '```ts'

/** fence closes an embedded code block in Tao fixture source. */
export const fence = '```'

/** app wraps a MainView body in the standard standalone Tao app fixture. */
export function app(body: string, extra = ''): string {
  return `
    app MyApp { view MainView }
    view MainView() { ${body} }
    ${extra}
  `
}

/** stubView returns a renderable Tao view fixture with an injected no-op implementation. */
export function stubView(name: string, parameters = ''): string {
  return `
    view ${name}(${parameters}) {
      render inject ${tsFence}
        return null
      ${fence}
    }
  `
}

/** stubContainer returns a content-accepting Tao view fixture with an injected no-op implementation. */
export function stubContainer(name: string, parameters = ''): string {
  return `
    view ${name}(${parameters}) {
      render inject Content @@content ${tsFence}
        return Content
      ${fence}
    }
  `
}
