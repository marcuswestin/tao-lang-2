import { languageServerExtensions, LSPClient, type Transport } from '@codemirror/lsp-client'
import { EditorState, type Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import React from 'react'
import TR from 'tao-runtime/TR'

/** CodeEditorLsp connects one editor document to Studio's existing JSON-over-WebSocket LSP transport. */
export type CodeEditorLsp = {
  documentUri: string
  languageId?: string
  rootUri: string
  transport: Transport | Promise<Transport>
}

export type CodeEditorHighlightToken = Readonly<{
  color?: string
  from: number
  to: number
}>

export type CodeEditorEditorDocument = { lineAt(position: number): { from: number; text: string } }

/**
 * Optional drag-and-drop insertion. `accepts` is checked against `dataTransfer.types` during
 * dragover, where the payload itself is unreadable; `apply` runs on drop and returns the
 * transaction to dispatch. Dispatching through the view is what keeps the insertion undoable.
 */
export type CodeEditorDrop = Readonly<{
  accepts: readonly string[]
  apply: (
    transfer: DataTransfer,
    context: Readonly<{ document: CodeEditorEditorDocument; position: number }>,
  ) =>
    | { changes: { from: number; insert: string; to: number }; selection?: { anchor: number; head: number } }
    | undefined
}>

export type CodeEditorProps = {
  Change: TR.ActionValue<[TR.Value<string>]>
  Content: string
  Drop?: CodeEditorDrop
  Highlight?: (content: string) => Promise<readonly CodeEditorHighlightToken[]>
  Layout?: TR.TaoVisualLayout
  Lsp?: CodeEditorLsp
  Selection?: Readonly<{ anchor: number; head?: number }>
  SelectionChange?: (selection: Readonly<{ anchor: number; head: number }>) => void
  Slots?: Readonly<Record<string, React.ReactNode>>
  Tag?: string
  children?: React.ReactNode
}

const setCodeEditorHighlight = StateEffect.define<readonly CodeEditorHighlightToken[]>()
const highlightColorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

const codeEditorHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  provide: field => EditorView.decorations.from(field),
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setCodeEditorHighlight)) {
        next = buildCodeEditorHighlightDecorations(effect.value, transaction.newDoc.length)
      }
    }
    return next
  },
})

/** CodeMirror's standard interaction surface and Tao's line-comment convention. */
export const codeEditorBaseExtensions: readonly Extension[] = [
  basicSetup,
  codeEditorHighlightField,
  EditorState.languageData.of(() => [{ commentTokens: { line: '//' } }]),
  EditorView.theme({
    '.cm-content': { caretColor: '#f8fafc' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#f8fafc',
      borderLeftWidth: '2px',
    },
  }, { dark: true }),
]

export const CodeEditorHighlighting = {
  testing: { buildDecorations: buildCodeEditorHighlightDecorations },
} as const

/** CodeEditor is the foreign-view implementation used by Studio's Tao-authored editor surface. */
export function CodeEditor(props: CodeEditorProps): React.ReactElement {
  const mount = React.useRef<HTMLDivElement>(null)
  const editor = React.useRef<EditorView | undefined>(undefined)
  const change = React.useRef(props.Change)
  const content = React.useRef(props.Content)
  const selectionChange = React.useRef(props.SelectionChange)
  const drop = React.useRef(props.Drop)
  const applyingExternalContent = React.useRef(false)
  change.current = props.Change
  content.current = props.Content
  selectionChange.current = props.SelectionChange
  drop.current = props.Drop

  React.useEffect(() => {
    const parent = mount.current
    if (parent === null) {
      return
    }
    let cancelled = false
    let highlightRevision = 0
    let highlightTimer: ReturnType<typeof setTimeout> | undefined
    let ownedClient: LSPClient | undefined
    const scheduleHighlight = (view: EditorView, nextContent: string, delayMs = 60): void => {
      const revision = ++highlightRevision
      clearTimeout(highlightTimer)
      if (props.Highlight === undefined) {
        return
      }
      highlightTimer = setTimeout(() => {
        void props.Highlight?.(nextContent).then(tokens => {
          if (!cancelled && revision === highlightRevision && view.state.doc.toString() === nextContent) {
            view.dispatch({ effects: setCodeEditorHighlight.of(tokens) })
          }
        }).catch(() => {
          // Syntax highlighting is presentation-only; editing and LSP behavior remain available.
        })
      }, delayMs)
    }
    const view = new EditorView({
      doc: content.current,
      extensions: [
        ...codeEditorBaseExtensions,
        EditorView.updateListener.of(update => {
          if (update.docChanged && !applyingExternalContent.current) {
            void invokeEditorChange(change.current, update.state.doc.toString())
          }
          if (update.docChanged) {
            scheduleHighlight(update.view, update.state.doc.toString())
          }
          if (update.selectionSet) {
            selectionChange.current?.({
              anchor: update.state.selection.main.anchor,
              head: update.state.selection.main.head,
            })
          }
        }),
      ],
      parent,
    })
    editor.current = view
    const onDragOver = (event: DragEvent): void => {
      const spec = drop.current
      if (spec !== undefined && spec.accepts.some(type => event.dataTransfer?.types.includes(type) === true)) {
        event.preventDefault()
      }
    }
    const onDrop = (event: DragEvent): void => {
      const spec = drop.current
      if (spec === undefined || event.dataTransfer === null) {
        return
      }
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
      const transaction = spec.apply(event.dataTransfer, { document: view.state.doc, position })
      if (transaction === undefined) {
        return
      }
      event.preventDefault()
      view.dispatch(transaction)
      view.focus()
    }
    view.dom.addEventListener('dragover', onDragOver)
    view.dom.addEventListener('drop', onDrop)
    scheduleHighlight(view, content.current, 0)

    const startLsp = async (): Promise<void> => {
      if (props.Lsp === undefined) {
        return
      }
      try {
        const client = new LSPClient({
          extensions: languageServerExtensions(),
          rootUri: props.Lsp.rootUri,
          timeout: 10_000,
        })
        ownedClient = client
        const transport = await props.Lsp.transport
        if (cancelled) {
          client.disconnect()
          return
        }
        client.connect(transport)
        await client.initializing
        if (cancelled) {
          client.disconnect()
          return
        }
        view.dispatch({
          effects: StateEffect.appendConfig.of(
            client.plugin(props.Lsp.documentUri, props.Lsp.languageId ?? 'tao'),
          ),
        })
      } catch (error) {
        ownedClient?.disconnect()
        ownedClient = undefined
        console.error('Tao CodeEditor language support could not start; continuing without LSP.', error)
      }
    }
    void startLsp()

    return () => {
      cancelled = true
      clearTimeout(highlightTimer)
      view.destroy()
      if (editor.current === view) {
        editor.current = undefined
      }
      ownedClient?.disconnect()
    }
  }, [props.Highlight, props.Lsp?.documentUri, props.Lsp?.languageId, props.Lsp?.rootUri, props.Lsp?.transport])

  React.useEffect(() => {
    const view = editor.current
    if (!view || view.state.doc.toString() === props.Content) {
      return
    }
    applyingExternalContent.current = true
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.Content } })
    } finally {
      applyingExternalContent.current = false
    }
  }, [props.Content])

  React.useEffect(() => {
    const view = editor.current
    if (!view || props.Selection === undefined) {
      return
    }
    const anchor = Math.max(0, Math.min(props.Selection.anchor, view.state.doc.length))
    const head = Math.max(0, Math.min(props.Selection.head ?? anchor, view.state.doc.length))
    if (view.state.selection.main.anchor !== anchor || view.state.selection.main.head !== head) {
      view.dispatch({ selection: { anchor, head } })
    }
  }, [props.Selection?.anchor, props.Selection?.head])

  const native = TR.VisualNativeProps(props.Layout, props.Tag)
  const dataSet = native['dataSet']
  const taoStudio = typeof dataSet === 'object' && dataSet !== null
    ? (dataSet as Record<string, unknown>)['taoStudio']
    : undefined
  return (
    <div
      data-tao-studio={typeof taoStudio === 'string' ? taoStudio : undefined}
      data-testid={props.Tag}
      style={props.Layout?.style as React.CSSProperties | undefined}
    >
      <div ref={mount} />
      {props.children}
      {Object.entries(props.Slots ?? {}).map(([name, content]) => <React.Fragment key={name}>{content}
      </React.Fragment>)}
    </div>
  )
}

function buildCodeEditorHighlightDecorations(
  tokens: readonly CodeEditorHighlightToken[],
  documentLength = Number.POSITIVE_INFINITY,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const validTokens = tokens
    .filter(token =>
      token.from >= 0
      && token.from < token.to
      && token.to <= documentLength
      && token.color !== undefined
      && highlightColorPattern.test(token.color)
    )
    .sort((left, right) => left.from - right.from || left.to - right.to)
  for (const token of validTokens) {
    builder.add(token.from, token.to, Decoration.mark({ attributes: { style: `color: ${token.color}` } }))
  }
  return builder.finish()
}

/** invokeEditorChange preserves the Tao action boundary while exposing an ordinary editor string. */
export function invokeEditorChange(
  change: TR.ActionValue<[TR.Value<string>]>,
  content: string,
): void | Promise<void> {
  return change.invoke(TR.Value(content))
}

/** webSocketTransport adapts Studio's headerless JSON frames to @codemirror/lsp-client. */
export function webSocketTransport(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const handlers = new Set<(value: string) => void>()
    const socket = new WebSocket(url)
    let settled = false
    socket.addEventListener('open', () => {
      settled = true
      resolve({
        send(message) {
          socket.send(message)
        },
        subscribe(handler) {
          handlers.add(handler)
        },
        unsubscribe(handler) {
          handlers.delete(handler)
        },
      })
    })
    socket.addEventListener('message', event => {
      for (const handler of handlers) {
        handler(String(event.data))
      }
    })
    socket.addEventListener('error', () => {
      if (!settled) {
        settled = true
        socket.close()
        reject(new Error('Could not connect to the Tao language server.'))
      }
    })
  })
}
