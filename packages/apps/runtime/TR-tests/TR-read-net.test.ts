import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type React from 'react'
import type { TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { withReadAvailability } from '../TaoRuntime-src/TR-read-availability'
import { readContext, type TaoReadNet } from '../TaoRuntime-src/TR-read-net'

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

function queryRows(state: { Loading: boolean; Error: string; Refreshing?: boolean; Stale?: boolean }): unknown[] {
  const rows: unknown[] = []
  Object.defineProperties(rows, {
    Loading: { value: state.Loading, configurable: true },
    Error: { value: state.Error, configurable: true },
    Refreshing: { value: state.Refreshing, configurable: true },
    Stale: { value: state.Stale, configurable: true },
  })
  return rows
}

/** siteProps stands for the guarding view's props inside an app that declares a read guard. */
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
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], remaining))).toEqual(["You don't have access to this note."])
    schema.setStatus('error', 'Provider unavailable')
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], remaining))).toEqual(['Could not load this note.'])
    schema.setStatus('ready', '')
    TR.Data.Delete(TR.Value(note))
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], remaining))).toEqual(['This note could not be found.'])

    const loading = TR.GuardRender(TR.Value(queryRows({ Loading: true, Error: '' })), [], remaining)
    Expect((loading as PrimitiveElement).props.kind).toBe('View')
    const [spinner, label] = (loading as PrimitiveElement).props.viewProps.children as PrimitiveElement[]
    Expect(spinner!.props.kind).toBe('Spinner')
    Expect(spinner!.props.viewProps).toMatchObject({ label: 'Loading items.' })
    Expect(runtimeText(label)).toEqual(['Loading items.'])
  })

  Test('lets a case the guard names win over the net', () => {
    const { note } = storedNote()
    TR.Data.Delete(TR.Value(note))
    const net = siteProps({ missing: () => 'App gone' })

    Expect(TR.GuardRender(TR.Value(note), [['missing', () => 'Site gone']], () => 'Editor', net)).toBe('Site gone')
    Expect(TR.GuardRender(TR.Value(note), [['loading', () => 'Site loading']], () => 'Editor', net)).toBe('App gone')
  })

  Test('passes one safe context to local and app handlers without exposing provider diagnostics', () => {
    const { note, schema } = storedNote()
    const contexts: Record<string, unknown>[] = []
    const props = siteProps({
      error: (_, context) => {
        contexts.push(context.evaluate().jsValue as unknown as Record<string, unknown>)
        return 'App error'
      },
    })
    schema.setStatus('error', 'gateway=secret disk full')
    Expect(TR.GuardRender(
      TR.Value(note),
      [['error', context => {
        contexts.push(context.evaluate().jsValue as unknown as Record<string, unknown>)
        return 'Local error'
      }]],
      () => 'Editor',
      props,
    )).toBe('Local error')
    Expect(TR.GuardRender(TR.Value(note), [], () => 'Editor', props)).toBe('App error')
    Expect(contexts).toHaveLength(2)
    for (const context of contexts) {
      Expect(context['State']).toBe('error')
      Expect(context['Message']).toBe('Could not load this note.')
      Expect(context['ReadKind']).toBe('entity')
      Expect(context['SubjectType']).toBe('Note')
      Expect(JSON.stringify(context)).not.toContain('gateway=secret')
      Expect(context['Retry']).toBeUndefined()
      Expect(context['Retryable']).toBeUndefined()
      Expect(context['Recovery']).toBeUndefined()
      Expect(context['ErrorCategory']).toBeUndefined()
    }
  })

  Test('keeps ordinary entity when error payloads as text while its fallback uses safe context', () => {
    const { note, schema } = storedNote()
    const props = siteProps({ error: (_, context) => context.evaluate().jsValue.Message })
    schema.setStatus('error', 'Provider unavailable')
    Expect(TR.WhenReadRender(
      TR.Value(note),
      [['error', message => message.evaluate().jsValue]],
      () => 'Editor',
      props,
    )).toBe('Provider unavailable')
    Expect(TR.WhenReadRender(TR.Value(note), [], () => 'Editor', props)).toBe('Could not load this note.')
  })

  Test('preserves account availability metadata for ordinary when branches and safe app fallback', () => {
    const account = TR.Value(null)
    withReadAvailability(account.evaluate(), { status: 'error', message: 'Private account detail' })
    const kinds: string[] = []
    const props = siteProps({
      error: (_, context) => {
        kinds.push(context.evaluate().jsValue.ReadKind)
        return context.evaluate().jsValue.Message
      },
    })
    Expect(TR.WhenReadRender(
      account,
      [['error', message => message.evaluate().jsValue]],
      () => 'Account',
      props,
    )).toBe('Private account detail')
    Expect(TR.WhenReadRender(account, [], () => 'Account', props)).toBe('Unable to load this item.')
    Expect(kinds).toEqual(['account'])
  })

  Test('merges inherited read-net cases and lets the variant replace one case', () => {
    const base = TR.ReadNet({ loading: () => 'Inherited loading', error: () => 'Inherited error' })
    const own = TR.ReadNet({ loading: () => 'Own loading' })
    const merged = TR.MergeReadNet(base, own)
    const props = siteProps(merged)
    Expect(TR.GuardRender(TR.Value(queryRows({ Loading: true, Error: '' })), [], () => 'Rows', props)).toBe(
      'Own loading',
    )
    Expect(TR.GuardRender(TR.Value(queryRows({ Loading: false, Error: 'Private backend' })), [], () => 'Rows', props))
      .toBe(
        'Inherited error',
      )
    Expect(Object.isFrozen(merged)).toBe(true)
  })

  Test('uses a proven site hint and keeps cached refresh and stale rows as content', () => {
    const seen: unknown[] = []
    const pending = TR.Value(queryRows({ Loading: true, Error: '' }))
    Expect(TR.GuardRender(
      pending,
      [['loading', context => {
        seen.push(context.evaluate().jsValue)
        return 'Loading reference'
      }]],
      () => 'Rows',
      undefined,
      { readKind: 'reference', subjectLabel: 'Draft', subjectType: 'Note' },
    ))
      .toBe('Loading reference')
    Expect(seen).toMatchObject([{
      State: 'loading',
      ReadKind: 'reference',
      SubjectLabel: 'Draft',
      SubjectType: 'Note',
      Message: 'Loading Draft.',
      LoadingPhase: 'initial',
    }])
    Expect(TR.GuardRender(TR.Value(queryRows({ Loading: false, Error: '', Refreshing: true })), [], () => 'Rows'))
      .toBe('Rows')
    Expect(TR.GuardRender(TR.Value(queryRows({ Loading: false, Error: '', Stale: true })), [], () => 'Rows'))
      .toBe('Rows')
    Expect(TR.GuardRender(
      TR.Value(queryRows({ Loading: false, Error: 'backend detail' })),
      [['error', context => context.evaluate().jsValue.Message]],
      () => 'Rows',
      undefined,
      { subjectType: 'HTTPResponse' },
    )).toBe('Could not load this http response.')
  })

  Test('describes an unresolved reference without claiming deletion', () => {
    const context = readContext('missing', { readKind: 'reference', subjectType: 'Note' }, {
      MissingReason: 'unresolved-reference',
    })
    Expect(context.Message).toBe('Could not resolve the link to this note.')
    Expect(context.MissingReason).toBe('unresolved-reference')
  })

  Test("renders the app's guard where it replaces a case, and the runtime's where it does not", () => {
    const { note, schema } = storedNote()
    const calls: unknown[] = []
    const props = siteProps({
      error: (handlerProps, context) => {
        calls.push(handlerProps.__tao)
        return `App error: ${context.evaluate().jsValue.Message}`
      },
    })

    schema.setStatus('error', 'Disk full')
    Expect(TR.GuardRender(TR.Value(note), [], () => 'Editor', props)).toBe('App error: Could not load this note.')
    Expect(calls).toEqual([props])
    schema.setStatus('unauthorized', '')
    Expect(runtimeText(TR.GuardRender(TR.Value(note), [], () => 'Editor', props))).toEqual([
      "You don't have access to this note.",
    ])
  })

  Test('never hands content cases to the net', () => {
    const net = siteProps({ loading: () => 'Net', error: () => 'Net' })

    Expect(TR.GuardRender(TR.Value(false), [['true', () => 'Yes']], () => 'No', net)).toBe('No')
    Expect(TR.GuardRender(TR.Value(queryRows({ Loading: false, Error: '' })), [], () => 'Rows', net)).toBe('Rows')
  })
})
