import TR from '@runtime/TR'
import React from 'react'
import { StudioApiClient } from '../client/StudioApiClient'
import { fileUri, sanitizeLspHtml, StudioEditorInsertion } from '../client/StudioEditor'
import { StudioLens, type StudioLensFacet } from '../client/StudioLens'
import { studioPaletteMime, StudioPaletteTransfer } from '../client/StudioVisualEditing'
import {
  CodeEditor,
  type CodeEditorDrop,
  type CodeEditorLensFacet,
  type CodeEditorLensMap,
  type CodeEditorLensProps,
  type CodeEditorLsp,
} from '../code-editor/CodeEditor'
import { StudioProductHostLspLifecycle } from '../StudioProductHostLsp'
import {
  requestStudioProductHostChangeActiveFile,
  requestStudioProductHostSelectActiveFile,
  studioProductHostState,
  subscribeStudioProductHostState,
} from '../StudioProductHostProtocol'

/**
 * The editor asks for colors and for the lens map in the same tick, so one request serves both. A
 * failed transport request is evicted, however: caching its rejected promise would make the lens and
 * highlighting permanently fail for unchanged text after the language service recovered.
 */
export function createStudioSourceAnalyzer<Result>(
  analyze: (content: string) => Promise<Result>,
): (content: string) => Promise<Result> {
  let last: { content: string; result: Promise<Result> } | undefined
  return content => {
    if (last?.content !== content) {
      const result = analyze(content)
      last = { content, result }
      void result.catch(() => {
        if (last?.result === result) {
          last = undefined
        }
      })
    }
    return last.result
  }
}

const analyzeTaoSource = createStudioSourceAnalyzer(StudioApiClient.highlight)

async function highlightTaoSource(content: string) {
  return (await analyzeTaoSource(content)).tokens
}

async function lensTaoSource(content: string): Promise<CodeEditorLensMap> {
  return (await analyzeTaoSource(content)).lens ?? { complete: false, nodes: [] }
}

const studioLensEditorFacets: readonly CodeEditorLensFacet[] = StudioLens.facets.map(facet => ({
  glyph: facet.glyph,
  label: facet.label,
  name: facet.name,
}))

function studioLensStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/**
 * isStudioLensCycleShortcut recognises Shift+Alt+L, which steps through the lens presets. The physical
 * key is checked first because Option+Shift+L types a different character on macOS; the letter is the
 * fallback for synthetic events that carry no key code.
 */
export function isStudioLensCycleShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
    && (event.code === 'KeyL' || event.key.toLowerCase() === 'l')
}

export type StudioLensBarProps = Readonly<{
  active: readonly StudioLensFacet[]
  onChange: (active: readonly StudioLensFacet[]) => void
  onRefold: () => void
}>

/** StudioLensBar is the editor's lens control: presets for a way of working, facets to fine-tune, and re-fold. */
export function StudioLensBar(props: StudioLensBarProps): React.ReactElement {
  const preset = StudioLens.presetFor(props.active)
  return (
    <div
      className="studio-lens-bar"
      data-testid="studio-lens-bar"
      data-preset={preset?.id ?? 'custom'}
      role="toolbar"
      aria-label="Syntax lens"
    >
      <span className="studio-lens-bar-group" role="group" aria-label="Lens presets">
        {StudioLens.presets.map(candidate => (
          <button
            aria-pressed={candidate.id === preset?.id}
            className="studio-lens-preset"
            data-testid={`studio-lens-preset-${candidate.id}`}
            key={candidate.id}
            onClick={() => props.onChange(candidate.facets)}
            title={`Show ${candidate.facets.length === 0 ? 'declaration heads only' : candidate.facets.join(', ')}`}
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </span>
      <span className="studio-lens-bar-divider" aria-hidden="true" />
      <span className="studio-lens-bar-group" role="group" aria-label="Lens facets">
        {StudioLens.facets.map(facet => (
          <button
            aria-pressed={props.active.includes(facet.name)}
            className="studio-lens-facet"
            data-testid={`studio-lens-facet-${facet.name}`}
            key={facet.name}
            onClick={() => props.onChange(StudioLens.toggle(props.active, facet.name))}
            title={facet.hint}
            type="button"
          >
            <span className="studio-lens-glyph" aria-hidden="true">{facet.glyph}</span>
            {facet.label}
          </button>
        ))}
      </span>
      <button
        className="studio-lens-refold"
        data-testid="studio-lens-refold"
        onClick={props.onRefold}
        title="Fold everything peeked open again (Shift+Alt+L cycles presets)"
        type="button"
      >
        Re-fold
      </button>
    </div>
  )
}

/** StudioEditorSurface is the Tao-mounted CodeEditor boundary over the host's revisioned active tab. */
export function StudioEditorSurface(): React.ReactElement {
  const state = React.useSyncExternalStore(
    subscribeStudioProductHostState,
    studioProductHostState,
    studioProductHostState,
  )
  const file = state.activeFile
  const lsp = useStudioEditorLsp(file?.path, state.projectRoot)
  // The lens is one global preference: it follows the person across files and projects.
  const [lensActive, setLensActive] = React.useState<readonly StudioLensFacet[]>(() =>
    StudioLens.load(studioLensStorage())
  )
  const [lensRefold, setLensRefold] = React.useState(0)
  const changeLens = React.useCallback((next: readonly StudioLensFacet[]) => {
    setLensActive(next)
    StudioLens.save(studioLensStorage(), next)
  }, [])
  const refoldLens = React.useCallback(() => setLensRefold(revision => revision + 1), [])
  const lensProps = React.useMemo<CodeEditorLensProps>(() => ({
    active: lensActive,
    classify: lensTaoSource,
    facets: studioLensEditorFacets,
    refoldRevision: lensRefold,
  }), [lensActive, lensRefold])
  const onLensKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (isStudioLensCycleShortcut(event)) {
      event.preventDefault()
      changeLens(StudioLens.cycle(lensActive))
    }
  }, [changeLens, lensActive])
  const change = React.useMemo(() =>
    ({
      invoke(value: TR.Value<string>) {
        requestStudioProductHostChangeActiveFile(value.evaluate().jsValue)
      },
    }) as TR.ActionValue<[TR.Value<string>]>, [])
  const wrapper = React.useRef<HTMLDivElement>(null)
  // The legacy shell wires palette drops onto its own CodeMirror, which is not the editor Tao
  // renders, so a component dropped on the visible editor landed nowhere. Dispatching through the
  // live view also keeps the insertion on CodeMirror's undo history.
  const paletteDrop = React.useMemo<CodeEditorDrop>(() => ({
    accepts: [studioPaletteMime],
    apply(transfer, context) {
      const item = StudioPaletteTransfer.parse(transfer.getData(studioPaletteMime))
      return item === undefined
        ? undefined
        : StudioEditorInsertion.transaction(context.document, item.snippet, context.position)
    },
  }), [])
  React.useEffect(() => {
    const target = wrapper.current?.parentElement
    if (target === null || target === undefined) {
      return
    }
    target.dataset['taoEditorMounted'] = 'true'
    return () => {
      delete target.dataset['taoEditorMounted']
    }
  }, [])
  if (file === undefined) {
    return <div className="studio-editor-tao-surface studio-empty" ref={wrapper}>Open a Tao file to edit.</div>
  }
  return (
    <div
      className="studio-editor-tao-surface"
      data-active-cell={state.activeCell?.cellId}
      data-active-file={file.path}
      data-active-scenario={state.activeCell?.scenarioId}
      data-selected-render={state.selectedRender?.renderId}
      data-state-revision={state.revision}
      onKeyDown={onLensKeyDown}
      ref={wrapper}
    >
      <StudioLensBar active={lensActive} onChange={changeLens} onRefold={refoldLens} />
      <CodeEditor
        Change={change}
        Content={file.content}
        DocumentChange={edit => requestStudioProductHostChangeActiveFile(edit.content, edit.selection)}
        Drop={paletteDrop}
        Highlight={highlightTaoSource}
        Layout={{ style: editorSurfaceStyle }}
        Lens={lensProps}
        Lsp={lsp}
        RevealRevision={file.revealRevision}
        Selection={{ anchor: file.selectionAnchor, head: file.selectionHead }}
        SelectionChange={selection => requestStudioProductHostSelectActiveFile(selection.anchor, selection.head)}
        Tag="studio-active-editor"
      />
    </div>
  )
}

function useStudioEditorLsp(path: string | undefined, projectRoot: string | undefined): CodeEditorLsp | undefined {
  const [connected, setConnected] = React.useState<
    Readonly<{ lsp: CodeEditorLsp; path: string; projectRoot: string }> | undefined
  >(undefined)
  React.useEffect(() => {
    if (path === undefined || projectRoot === undefined) {
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const lifecycle = new StudioProductHostLspLifecycle(
      () => StudioApiClient.lspTransport(controller.signal),
      () => controller.abort(),
    )
    void lifecycle.open().then(transport => {
      if (transport !== undefined) {
        setConnected({
          lsp: {
            documentUri: fileUri(projectRoot, path),
            languageId: 'tao',
            rootUri: fileUri(projectRoot),
            sanitizeHTML: sanitizeLspHtml,
            transport,
          },
          path,
          projectRoot,
        })
      }
    }).catch(error => {
      if (!cancelled) {
        console.error('Tao Studio ProductHost language support could not connect.', error)
      }
    })
    return () => {
      cancelled = true
      lifecycle.close()
    }
  }, [path, projectRoot])
  return connected !== undefined && connected.path === path && connected.projectRoot === projectRoot
    ? connected.lsp
    : undefined
}

const editorSurfaceStyle = {
  height: '100%',
  minHeight: 0,
  minWidth: 0,
} satisfies React.CSSProperties
