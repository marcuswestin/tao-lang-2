/** previewNoticeFor explains a preview the project's current state cannot back with a live app. */
export function previewNoticeFor(
  compile: {
    diagnostics?: readonly { filePath?: string; message: string; range?: { start: { line: number } } }[]
    message: string
    status: string
  },
): { detail: string; heading: string } | undefined {
  if (compile.status !== 'error') {
    return undefined
  }
  const diagnostic = compile.diagnostics?.[0]
  const where = diagnostic?.filePath === undefined
    ? ''
    : `${diagnostic.filePath.split('/').at(-1) ?? diagnostic.filePath}${
      diagnostic.range === undefined ? '' : `:${diagnostic.range.start.line + 1}`
    } — `
  return {
    detail: `${where}${diagnostic?.message ?? compile.message}`,
    heading: 'This preview is out of date: the project did not compile.',
  }
}

/**
 * previewBundleNoticeFor explains a preview whose app never started. The Tao project compiles, so nothing in
 * the problems panel is wrong; the failure is in the bundler that builds the generated TypeScript, and it
 * otherwise shows only as an empty frame.
 */
export function previewBundleNoticeFor(
  diagnosis: { message?: string; status: string } | undefined,
): { detail: string; heading: string } | undefined {
  if (diagnosis === undefined || diagnosis.status === 'ok' || diagnosis.status === 'unknown') {
    return undefined
  }
  if (diagnosis.status === 'unreachable') {
    return {
      detail: `${diagnosis.message ?? 'no response'} — reload the preview, or restart Studio.`,
      heading: 'This preview is empty: its app server did not answer.',
    }
  }
  return {
    detail: `${diagnosis.message ?? 'the bundler reported no detail'} — reload the preview, or restart Studio.`,
    heading: 'This preview is empty: the project compiled, but the app bundle failed to build.',
  }
}

/** studioPreviewNotice puts a human-facing explanation over the preview, without discarding a live frame. */
export function studioPreviewNotice(
  parent: HTMLElement,
  notice: { detail: string; heading: string } | undefined,
): void {
  const existing = parent.querySelector<HTMLElement>(':scope > .studio-preview-notice')
  if (notice === undefined) {
    existing?.remove()
    return
  }
  const element = existing ?? document.createElement('div')
  element.className = 'studio-preview-notice'
  element.setAttribute('role', 'status')
  const heading = element.querySelector<HTMLElement>('strong') ?? document.createElement('strong')
  heading.textContent = notice.heading
  const detail = element.querySelector<HTMLElement>('small') ?? document.createElement('small')
  detail.textContent = notice.detail
  element.replaceChildren(heading, detail)
  if (existing === null) {
    parent.append(element)
  }
}
