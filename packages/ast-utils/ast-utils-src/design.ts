import { AST } from '@parser'

/** standardDesignElementName returns the published @tao/ui element name for one linked render. */
export function standardDesignElementName(render: AST.Render): string | undefined {
  const view = render.view?.ref
  if (view === undefined || !/^[A-Z][A-Za-z0-9_]*$/.test(view.name)) {
    return undefined
  }
  const path = AST.getDocument(view).uri.path
  return path.includes('/@tao/ui/') ? view.name : undefined
}
