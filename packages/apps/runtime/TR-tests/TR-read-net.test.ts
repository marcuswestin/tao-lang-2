import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type React from 'react'
import type { TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import type { TaoReadNet } from '../TaoRuntime-src/TR-read-net'

const noteDefinition: TaoDataSchemaDefinition = {
  name: 'ReadNetNotes',
  schemaVersion: 1,
  entities: {
    Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } },
  },
}

type PrimitiveElement = React.ReactElement<{
  kind: string
  runtimeProps: { designDefault?: string }
  viewProps: { children?: unknown }
}>

function storedNote(): { note: Record<string, unknown>; schema: ReturnType<typeof TR.Data.Schema> } {
  const schema = TR.Data.Schema(noteDefinition, testDataConnection())
  TR.Data.Create(schema, 'Note', { Title: TR.Value('Draft') })
  const note = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>
  return { note, schema }
}

function queryRows(state: { Loading: boolean; Error: string }): unknown[] {
  const rows: unknown[] = []
  Object.defineProperties(rows, {
    Loading: { value: state.Loading, configurable: true },
    Error: { value: state.Error, configurable: true },
  })
  return rows
}

/** siteProps stands for the guarding view's props inside an app that declares `guard default`. */
function siteProps(readNet: TaoReadNet): TR.TaoProps {
  return { app: { readNet } as unknown as TR.TaoProps['app'] }
}

function runtimeText(node: React.ReactNode): unknown {
  const element = node as PrimitiveElement
  Expect(element.props.kind).toBe('Text')
  Expect(element.props.runtimeProps.designDefault).toBe('Text')
  return element.props.viewProps.children
}

Describe('TR read net', () => {
  Test('renders the runtime net for every exceptional case a guard leaves unnamed', () => {
    const { note, schema } = storedNote()
    const remaining = () => 'Document editor'

    Expect(TR.GuardRender(TR.Value(note), [], remaining)).toBe('Document editor')
    schema.setStatus('unauthorized', '')
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], remaining))).toEqual(["You don't have access to this"])
    schema.setStatus('error', 'Provider unavailable')
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], remaining))).toEqual(['Provider unavailable'])
    schema.setStatus('ready', '')
    TR.Data.Delete(TR.Value(note))
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], remaining))).toEqual(['This is gone'])

    const loading = TR.GuardRender(TR.Value(queryRows({ Loading: true, Error: '' })), [], remaining)
    Expect((loading as PrimitiveElement).props.kind).toBe('Spinner')
  })

  Test('lets a case the guard names win over the net', () => {
    const { note } = storedNote()
    TR.Data.Delete(TR.Value(note))
    const net = siteProps({ missing: () => 'App gone' })

    Expect(TR.GuardRender(TR.Value(note), [['missing', () => 'Site gone']], () => 'Editor', net)).toBe('Site gone')
    Expect(TR.GuardRender(TR.Value(note), [['loading', () => 'Site loading']], () => 'Editor', net)).toBe('App gone')
  })

  Test("renders the app's guard default where it replaces a case, and the runtime's where it does not", () => {
    const { note, schema } = storedNote()
    const calls: unknown[] = []
    const props = siteProps({
      error: (handlerProps, message) => {
        calls.push(handlerProps.__tao)
        return `App error: ${message.evaluate().jsValue}`
      },
    })

    schema.setStatus('error', 'Disk full')
    Expect(TR.GuardRender(TR.Value(note), [], () => 'Editor', props)).toBe('App error: Disk full')
    Expect(calls).toEqual([props])
    schema.setStatus('unauthorized', '')
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], () => 'Editor', props))).toEqual([
      "You don't have access to this",
    ])
  })

  Test('never hands content cases to the net', () => {
    const net = siteProps({ loading: () => 'Net', error: () => 'Net' })

    Expect(TR.GuardRender(TR.Value([]), [], () => 'List', net)).toBe('List')
    Expect(TR.GuardRender(TR.Value(''), [], () => 'Text', net)).toBe('Text')
    Expect(TR.GuardRender(TR.Value(false), [['true', () => 'Yes']], () => 'No', net)).toBe('No')
    Expect(TR.GuardRender(TR.Value(queryRows({ Loading: false, Error: '' })), [], () => 'Rows', net)).toBe('Rows')
  })
})
