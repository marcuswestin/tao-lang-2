import type TR from '@runtime/TR'
import { Assert, FS, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { studioPaletteComponents } from '../studio-src/StudioInspector'
import type { StudioProductHostState } from '../studio-src/StudioProductHostProtocol'
import {
  FileCreateBar,
  FilesPanelSurface,
  productHostStyle,
  StudioButton,
  StudioChoice,
  StudioDataRows,
  StudioDesignTokenRow,
  StudioDesignTokenSection,
  StudioFeedDrag,
  StudioFeedEntityPayload,
  StudioFeedRowControl,
  StudioFeedSeedPayload,
  StudioFeedSourcePayload,
  StudioInspectorAction,
  StudioInspectorActionIds,
  StudioInspectorActionLabel,
  StudioInspectorActionValid,
  StudioInspectorBindTextAction,
  StudioInspectorDataLines,
  StudioInspectorDraft,
  StudioInspectorDraftsFor,
  StudioInspectorLayoutAction,
  StudioInspectorLayoutActionValid,
  StudioInspectorLayoutDrafts,
  StudioInspectorSetTextAction,
  StudioInspectorSetTextValid,
  StudioInspectorStyleAction,
  StudioInspectorStyleActionValid,
  StudioInspectorStyleDrafts,
  StudioInspectorStyleFieldOptions,
  StudioInspectorStyleNotes,
  StudioInspectorStylePromotionAction,
  StudioInspectorStylePromotionIds,
  StudioInspectorStylePromotionLabel,
  StudioInspectorSummaryLines,
  StudioInspectorTextActionValid,
  StudioInspectorTextAvailable,
  StudioInspectorTextBindingLabel,
  StudioInspectorTextCandidates,
  StudioInspectorTextDraft,
  StudioInspectorTextLiteral,
  StudioInspectorTextStatus,
  StudioInspectorTextUpdateDraft,
  StudioInspectorUpdateDraft,
  studioNumericDraft,
  StudioNumericInput,
  StudioPaletteRow,
  StudioProductHostMountIdentity,
  StudioRadioKeys,
  StudioScenarioArgumentDrafts,
  StudioScenarioArgumentIds,
  studioScenarioArguments,
  StudioScenarioArgumentsPayload,
  StudioScenarioArgumentsValid,
  StudioScenarioCapturedLayers,
  StudioScenarioJourneyActive,
  StudioScenarioJourneyCanRecord,
  StudioScenarioJourneyCanSave,
  StudioScenarioJourneyCommand,
  StudioScenarioJourneyLines,
  StudioScenarioJourneyPayload,
  StudioScenarioJourneyStatus,
  StudioScenarioUpdateArgumentDraft,
  StudioSearchHit,
  StudioSearchLocation,
  StudioSegmented,
  TreeFileRow,
  type TreeFileRowProps,
  TreeFolder,
} from '../studio-src/TaoStudioProductHost'

function activeCell(cellRevision: number): NonNullable<StudioProductHostState['activeCell']> {
  return {
    cellId: 'cell:one',
    cellRevision,
    journeyRecordable: true,
    journeyRecording: 'null',
    networkLatencyMs: 0,
    networkOutcome: 'normal',
    scenarioId: 'scenario:one',
    scenarioModel: 'null',
    schemeCapability: 'reactive-browser',
    schemeRequested: 'system',
    schemeResolved: 'light',
    schemeSource: 'system',
    viewportHeight: 844,
    viewportWidth: 390,
  }
}

Test('Tao Studio keeps invalid numeric drafts out of typed environment actions', () => {
  Expect(studioNumericDraft('', { minimum: 1 })).toEqual({ valid: false })
  Expect(studioNumericDraft('NaN', { minimum: 1 })).toEqual({ valid: false })
  Expect(studioNumericDraft('0', { minimum: 1 })).toEqual({ valid: false })
  Expect(studioNumericDraft('99.5', { integer: true, maximum: 599, minimum: 100 })).toEqual({ valid: false })
  Expect(studioNumericDraft('600', { integer: true, maximum: 599, minimum: 100 })).toEqual({ valid: false })
  Expect(studioNumericDraft('503', { integer: true, maximum: 599, minimum: 100 })).toEqual({
    valid: true,
    value: 503,
  })
})

Test('Tao Studio segmented controls implement cyclic radio navigation', () => {
  Expect(StudioRadioKeys.nextIndex('ArrowRight', 3, 4)).toBe(0)
  Expect(StudioRadioKeys.nextIndex('ArrowDown', 1, 4)).toBe(2)
  Expect(StudioRadioKeys.nextIndex('ArrowLeft', 0, 4)).toBe(3)
  Expect(StudioRadioKeys.nextIndex('ArrowUp', 2, 4)).toBe(1)
  Expect(StudioRadioKeys.nextIndex('Home', 2, 4)).toBe(0)
  Expect(StudioRadioKeys.nextIndex('End', 1, 4)).toBe(3)
  Expect(StudioRadioKeys.nextIndex('Enter', 1, 4)).toBeUndefined()
  const Change = { invoke() {} } as unknown as TR.ActionValue<[TR.Value<string>]>
  const html = renderToStaticMarkup(React.createElement(StudioSegmented, {
    Change,
    Label: 'Device',
    Options: ['phone', 'tablet', 'laptop'],
    Value: 'tablet',
  }))
  Expect(html).toContain('role="radiogroup"')
  Expect(html).toContain('aria-label="Device"')
  Expect(html).toContain('aria-checked="true" role="radio" tabindex="0"')
})

Test('Tao Studio host buttons and pickers dispatch their Tao-owned actions', () => {
  let presses = 0
  let prevented = 0
  let focused = 0
  const choices: string[] = []
  const Press = {
    async invoke() {
      presses += 1
    },
  } as unknown as TR.ActionValue<[]>
  const Change = {
    async invoke(value: TR.Value<string>) {
      choices.push(value.evaluate().jsValue)
    },
  } as unknown as TR.ActionValue<[TR.Value<string>]>
  const button = StudioButton({ Disabled: false, Label: 'Apply', Press, Variant: 'primary' }) as React.ReactElement<{
    onClick: () => void
  }>
  const segmented = StudioSegmented({
    Change,
    Label: 'Device',
    Options: ['phone', 'tablet'],
    Value: 'phone',
  }) as React.ReactElement<{
    children: readonly React.ReactElement<{
      onKeyDown: (event: {
        currentTarget: { parentElement: { querySelectorAll: () => readonly { focus: () => void }[] } }
        key: string
        preventDefault: () => void
      }) => void
    }>[]
  }>
  const choice = StudioChoice({
    Change,
    Label: 'Scenario',
    Options: ['empty', 'filled'],
    Value: 'empty',
  }) as React.ReactElement<{ onChange: (event: { currentTarget: { value: string } }) => void }>

  button.props.onClick()
  segmented.props.children[0]!.props.onKeyDown({
    currentTarget: {
      parentElement: {
        querySelectorAll: () => [{ focus() {} }, {
          focus() {
            focused += 1
          },
        }],
      },
    },
    key: 'ArrowRight',
    preventDefault() {
      prevented += 1
    },
  })
  choice.props.onChange({ currentTarget: { value: 'filled' } })

  Expect(presses).toBe(1)
  Expect(prevented).toBe(1)
  Expect(focused).toBe(1)
  Expect(choices).toEqual(['tablet', 'filled'])
})

Test('Tao Studio environment number inputs expose their field labels', () => {
  const Change = { invoke() {} } as unknown as TR.ActionValue<[TR.Value<number>]>
  const ChangeValid = { invoke() {} } as unknown as TR.ActionValue<[TR.Value<boolean>]>
  const html = renderToStaticMarkup(React.createElement(StudioNumericInput, {
    Change,
    ChangeValid,
    Integer: false,
    Label: 'Width',
    Maximum: 0,
    Minimum: 1,
    Value: 390,
  }))
  Expect(html).toContain('aria-label="Width"')
})

Test('Tao Studio keeps scenario and environment drafts mounted across each other remounting the cell', () => {
  const before = activeCell(7)
  const after = activeCell(8)
  Expect(StudioProductHostMountIdentity.environment(after)).toBe(
    StudioProductHostMountIdentity.environment(before),
  )
  Expect(StudioProductHostMountIdentity.scenario(after)).toBe(StudioProductHostMountIdentity.scenario(before))
  Expect(StudioProductHostMountIdentity.scenario({ ...after, scenarioId: 'scenario:other' })).not.toBe(
    StudioProductHostMountIdentity.scenario(before),
  )
})

Test('Tao Studio search hits preserve path, line, and column', () => {
  Expect(StudioSearchLocation('/project/first/Main.tao', 12, 4)).toEndWith('first/Main.tao:13:5')
  Expect(StudioSearchLocation('/project/second/Main.tao', -1, -1)).toEndWith('second/Main.tao')
  const html = renderToStaticMarkup(React.createElement(StudioSearchHit, {
    Column: 4,
    Detail: 'Text("Needle")',
    Kind: 'render',
    Label: 'Needle',
    Line: 12,
    Open: { invoke() {} } as unknown as TR.ActionValue<[]>,
    Path: '/project/first/Main.tao',
  }))
  Expect(html).toContain('first/Main.tao:13:5')
  Expect(html).toContain('<b>Needle</b> · Text(&quot;Needle&quot;)')
})

Test('Tao Studio data rows render named columns and retain cells', () => {
  const html = renderToStaticMarkup(React.createElement(StudioDataRows, {
    Rows: ['{"Name":"Ada","Count":2}', '{"Name":"Grace","Count":3}'],
  }))
  Expect(html).toContain('<th>Name</th><th>Count</th>')
  Expect(html).toContain('<td title="Ada">Ada</td><td title="2">2</td>')
  Expect(html).toContain('<td title="Grace">Grace</td><td title="3">3</td>')
})

Test('Tao Studio product host retains viewport ownership over generated Tao layout', () => {
  Expect(productHostStyle({ height: 36, position: 'relative', width: 120 })).toMatchObject({
    bottom: 0,
    height: 'auto',
    left: 0,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    position: 'fixed',
    right: 0,
    top: 0,
    width: 'auto',
  })
})

Test('Tao Studio uses a content-only navigator and keeps recursive file CRUD in Tao', async () => {
  const source = await FS.readText(Repo.resolvePath('Apps/Tao Studio/TaoStudioClient.tao'))

  Expect(source).toContain('Navigator SlotNav')
  Expect(source).not.toContain('StackNav')
  Expect(source).not.toContain('Title "Tao Studio"')
  Expect(source).not.toContain('FormButton(')
  Expect(source).toContain('use Checkbox, Col, Text, TextInput from @tao/ui')
  Expect(source).not.toMatch(/\bButton\(/)
  Expect(source).not.toMatch(/\bPicker\(/)
  Expect(source).toContain(
    'view StudioButton(Label text, Press action(), Disabled boolean, Variant text) from '
      + '../../packages/ides/studio/studio-src/TaoStudioProductHost.tsx',
  )
  Expect(source).toContain(
    'view StudioSegmented(Value text, Change action(text), Options list of text, Label text) from '
      + '../../packages/ides/studio/studio-src/TaoStudioProductHost.tsx',
  )
  Expect(source).toContain('@environment StudioEnvironmentPanel(')
  Expect(source).toContain('view StudioEnvironmentPanel(ActiveCellId text, CellRevision number, ViewportPresetId text')
  Expect(source).toContain('view StudioScenarioEnvironment(')
  Expect(source).not.toContain('view StudioScenarioEnvironmentControls(')
  Expect(source).toContain('state Drafts = StudioScenarioArgumentDrafts(State)')
  Expect(source).toContain('loop StudioScenarioArgumentIds(State) / ParameterId')
  Expect(source).toContain('Appearance: ResolvedAppearance')
  Expect(source).not.toContain('StudioInspectorContextSurface(')
  Expect(source).toContain('view StudioInspectorLayout(')
  Expect(source).toContain('view StudioInspectorStyle(')
  Expect(source).toContain('view StudioInspectorData(')
  Expect(source).toContain('view StudioInspectorActions(')
  Expect(source).toContain('view StudioDrawerPanel(Tab text, Compile StudioCompilePanel')
  Expect(source).toContain('view StudioCompilePanelView(')
  Expect(source).toContain('view StudioProblemsPanelView(')
  Expect(source).toContain('view StudioDataPanelView(')
  Expect(source).toContain('view StudioDataRailPanel(Data StudioDataPanel)')
  Expect(source).toContain('Text [ink ink]')
  Expect(source).toContain('TextInput [background panel, border line, ink ink]')
  Expect(source).toContain('do OpenScreen(View.StableId)')
  Expect(source).toContain('do OpenSource(Path: DesignToken.SourcePath')
  Expect(source).toContain('where Kind == TokenKind')
  Expect(source).toContain('DesignTokenKindGroup(TokenKind: "color", Title: "colors")')
  Expect(source).toContain('DesignTokenKindGroup(TokenKind: "bundle", Title: "bundles")')
  Expect(source).toContain('view StudioTestsPanelView(')
  Expect(source).toContain('view StudioLogsPanelView(')
  Expect(source).toContain('view StudioSearchPanel(Rows list of StudioSearchPanelRow)')
  Expect(source).toContain('do Dispatch(Command.Name, Command.Payload)')
  Expect(source).not.toContain('StudioDrawerPanelSurface')
  Expect(source).not.toContain('StudioSearchPanelSurface')
  Expect(source).toContain('ServerOrigin text is ""')
  Expect(source).toContain('action SyncDraft(Path text, SourceVersion text, Content text) runs latest')
  Expect(source).toContain('@editor StudioCodeEditor()')
  Expect(source).toContain('@inspector StudioContextPanel(')
  Expect(source).toContain('view StudioContextPanel(Revision number, ProjectRoot text, ActiveFilePath text')
  Expect(source).toContain('FilePath: ActiveFilePath')
  Expect(source).toContain(
    'accepts content slots @files, @components, @projectViews, @screens, @tokens, @data, @search, @drawer, @scenario, @environment, @editor, @inspector',
  )
  Expect(source).toContain(
    '@scenario StudioScenarioPanel(State: "null", JourneyRecording: "null", JourneyRecordable: false, ResolvedAppearance: "light")',
  )
  Expect(source).toContain(
    'view StudioScenarioPanel(State text, JourneyRecording text, JourneyRecordable boolean, ResolvedAppearance text)',
  )
  Expect(source).toContain('StudioScenarioControlGroup("Record interaction")')
  Expect(source).toContain('Name: StudioScenarioJourneyCommand(JourneyRecording)')
  Expect(source).toContain('Name: "scenario-save-journey"')
  Expect(source).toContain('query Children = Files')
  Expect(source).toContain('FileTree(FolderPath: File.Path')
  Expect(source).toContain('do CreateFile(NewPath)')
  Expect(source).toContain('do RenameFile(Path: File.Path, SourceVersion: File.Version, TargetPath: RenamePath)')
  Expect(source).toContain('do DeleteFile(Path: File.Path, SourceVersion: File.Version)')
})

Test('Tao Studio ProductHost injects structured panel values without section-level render adapters', async () => {
  const source = await FS.readText(FS.resolvePath('../studio-src/TaoStudioProductHost.tsx', import.meta.dir))

  Expect(source).toContain('hostState.panels ?? StudioPanelProjection.empty()')
  Expect(source).toContain('Compile: TR.Value(panelValues.Drawer.Compile)')
  Expect(source).toContain('Rows: TR.Value(panelValues.Search.Rows)')
  Expect(source).not.toContain('export function StudioDrawerPanelSurface')
  Expect(source).not.toContain('export function StudioSearchPanelSurface')
  Expect(source).not.toContain('JSON.stringify(hostState.panels')
})

Test('Move to package prompts for a replacement only after a declaration conflict', async () => {
  const source = await FS.readText(FS.resolvePath('../studio-src/client/StudioApp.ts', import.meta.dir))

  Expect(source).toContain("if (result.status === 'confirmation-required')")
  Expect(source).toContain('const replacement = await StudioDialog.prompt(')
  Expect(source).not.toMatch(/window\.(confirm|prompt|alert)\(/)
  Expect(source.indexOf("result.status === 'confirmation-required'")).toBeLessThan(
    source.indexOf('StudioDialog.prompt('),
  )
})

Test('Tao Studio foreign file views render compact tree rows with contextual editing controls', () => {
  const action = noArgAction()
  const textAction = textArgAction()
  const surface = FilesPanelSurface({ children: React.createElement('span', null, 'Project tree') })
  const create = FileCreateBar({
    Change: textAction,
    Create: action,
    Path: 'Folder/New.tao',
  })
  const folder = TreeFolder({
    Expanded: true,
    Label: 'Folder',
    Toggle: action,
    children: React.createElement('span', null, 'Nested file'),
  })
  const compact = TreeFileRow(fileRowProps({}))
  const generated = TreeFileRow(fileRowProps({ Name: 'View1.tao', Path: '@/studio/View1.tao' }))
  const renaming = TreeFileRow(fileRowProps({ Renaming: true }))
  const deleting = TreeFileRow(fileRowProps({ ConfirmDelete: true }))

  Expect(property(surface, 'data-studio-files-surface')).toBe('compact')
  Expect(textContent(surface)).toBe('Project tree')
  Expect(property(create, 'data-studio-file-create')).toBe('compact')
  Expect(property(elementWith(create, 'aria-label', 'New Tao file path'), 'className')).toBe('studio-input')
  Expect(property(elementWith(create, 'aria-label', 'Create file'), 'className')).toBe('studio-icon-button')
  Expect(property(elementWith(folder, 'aria-expanded', true), 'aria-expanded')).toBe(true)
  Expect(textContent(folder)).toContain('Nested file')
  Expect(property(compact, 'data-studio-tree-file')).toBe('Folder/Roadmap.tao')
  Expect(elementWith(compact, 'aria-label', 'Unsaved draft')).toBeDefined()
  Expect(elementWith(compact, 'aria-label', '2 problems')).toBeDefined()
  Expect(elements(compact).some(element => property(element, 'aria-label') === 'Save rename')).toBe(false)
  Expect(elements(compact).some(element => property(element, 'role') === 'alert')).toBe(false)
  Expect(property(elementWith(compact, 'aria-label', 'Move Roadmap.tao to package'), 'hidden')).toBe(true)
  Expect(property(elementWith(generated, 'aria-label', 'Move View1.tao to package'), 'hidden')).toBe(false)
  Expect(elementWith(renaming, 'aria-label', 'Save rename')).toBeDefined()
  Expect(property(elementWith(renaming, 'aria-label', 'New path for Roadmap.tao'), 'value'))
    .toBe('Folder/Roadmap.tao')
  Expect(elementWith(deleting, 'role', 'alert')).toBeDefined()
  Expect(textContent(deleting)).toContain('Delete Roadmap.tao?')
})

Test('Design token rows group under a kind heading and swatch parseable colors', () => {
  const color = StudioDesignTokenRow({
    Detail: '#ff6600',
    Kind: 'color',
    Label: 'accent',
    Open: noArgAction(),
  })
  const bundle = StudioDesignTokenRow({
    Detail: 'pad 12, radius 10, bg card',
    Kind: 'bundle',
    Label: 'commentCard',
    Open: noArgAction(),
  })
  const section = StudioDesignTokenSection({ children: 'accent row', Title: 'colors' })

  Expect(property(color, 'className')).toBe('studio-design-token')
  Expect(property(color, 'data-studio-design-kind')).toBe('color')
  Expect(textContent(color)).toContain('accent')
  Expect(textContent(color)).toContain('#ff6600')
  Expect(property(elementWith(color, 'className', 'studio-design-token-swatch'), 'style')).toEqual({
    background: '#ff6600',
  })
  Expect(property(bundle, 'data-studio-design-kind')).toBe('bundle')
  Expect(textContent(bundle)).toContain('commentCard')
  Expect(textContent(bundle)).toContain('pad 12, radius 10, bg card')
  Expect(elements(bundle).some(element => property(element, 'className') === 'studio-design-token-swatch'))
    .toBe(false)
  Expect(property(section, 'className')).toBe('studio-design-token-kind')
  Expect(property(section, 'data-studio-design-kind')).toBe('colors')
  Expect(textContent(section)).toContain('colors')
  Expect(textContent(section)).toContain('accent row')
})

Test('Tao-owned component rows preserve canonical drag snippets at the native boundary', () => {
  let transfer: Readonly<{ type: string; value: string }> | undefined
  const row = StudioPaletteRow({
    Detail: 'Element',
    Insert: noArgAction(),
    Kind: 'component',
    Label: 'Button',
    Name: 'Button',
  })

  const onDragStart = property(row, 'onDragStart') as (event: {
    dataTransfer: { setData(type: string, value: string): void }
  }) => void
  onDragStart({
    dataTransfer: {
      setData(type, value) {
        transfer = { type, value }
      },
    },
  })

  Expect(property(row, 'draggable')).toBe(true)
  Expect(transfer?.type).toBe('application/x-tao-studio-palette')
  Expect(JSON.parse(transfer?.value ?? '{}')).toMatchObject({
    component: 'Button',
    kind: 'component',
    snippet: {
      placeholders: [{ end: 19, start: 7 }],
      text: 'Button("New button") {\n   on press -> { }\n}',
    },
  })
})

Test('Tao-owned component inventory stays aligned with the canonical Studio palette', async () => {
  const source = await FS.readText(Repo.resolvePath('Apps/Tao Studio/TaoStudioClient.tao'))
  const taoComponents = [...source.matchAll(/ComponentPaletteItem\(Name: "([^"]+)"/g)].map(match => match[1])

  Expect(taoComponents).toEqual(studioPaletteComponents.map(component => component.component))
})

Test('Tao-owned scenario drafts retain invalid values locally and emit typed arguments only when complete', () => {
  const model = {
    parameters: [
      { label: 'Count', parameterId: 'Count', required: true, type: { kind: 'number', minimum: 1 } },
      { label: 'Mode', parameterId: 'Mode', required: true, type: { kind: 'choice', values: ['grid', 'list'] } },
      { label: 'Options', parameterId: 'Options', required: false, type: { kind: 'json' } },
    ],
  } as const

  Expect(studioScenarioArguments(model, { Count: 'nope', Mode: '"grid"', Options: '{' })).toMatchObject({
    ok: false,
    issues: ['Count must be a finite number.', 'Options must be valid JSON.'],
  })
  Expect(studioScenarioArguments(model, { Count: '3', Mode: '"grid"', Options: '{"dense":true}' })).toEqual({
    ok: true,
    value: { Count: 3, Mode: 'grid', Options: { dense: true } },
  })
})

Test('Tao scenario helpers preserve cell identity and author only resolved appearance', () => {
  const state = JSON.stringify({
    arguments: { Count: 2 },
    capturedLayers: ['fixture-home', 'state-expanded'],
    cell: { compileRevision: 7, id: 'cell:states:phone', manifestRevision: 'manifest-7', revision: 3 },
    entry: { id: 'scenario-card', label: 'Card', subjectId: 'view:Card' },
    group: { id: 'group:states', label: 'states', sourcePath: 'Scenarios.tao' },
    parameters: [{ label: 'Count', parameterId: 'Count', required: true, type: { kind: 'number', minimum: 1 } }],
    version: 1,
  })
  const drafts = StudioScenarioArgumentDrafts(state)
  const invalid = StudioScenarioUpdateArgumentDraft(drafts, 'Count', 'not-a-number')

  Expect(StudioScenarioArgumentIds(state)).toEqual(['Count'])
  Expect(StudioScenarioCapturedLayers(state)).toEqual(['fixture-home', 'state-expanded'])
  Expect(StudioScenarioArgumentsValid(state, invalid)).toBe(false)
  Expect(JSON.parse(StudioScenarioArgumentsPayload(state, drafts, 'dark'))).toEqual({
    appearance: 'dark',
    arguments: { Count: 2 },
    cellId: 'cell:states:phone',
    cellRevision: 3,
  })
  Expect(() => StudioScenarioArgumentsPayload(state, drafts, 'system')).toThrow(
    'resolved light or dark scenario appearance',
  )
})

Test('Tao scenario journey helpers expose safe semantic drafts to the visible panel', () => {
  const state = JSON.stringify({
    arguments: {},
    capturedLayers: [],
    cell: { compileRevision: 7, id: 'cell:states:phone', manifestRevision: 'manifest-7', revision: 3 },
    entry: { id: 'scenario-card', label: 'Card', subjectId: 'view:Card' },
    group: { id: 'group:states', label: 'states', sourcePath: 'Scenarios.tao' },
    parameters: [],
    sourceIdentity: { appName: 'Garden', path: 'Scenarios.tao', project: '/project' },
    version: 1,
  })
  const recording = JSON.stringify({
    busy: false,
    captureSensitiveText: false,
    id: 'recording-1',
    status: 'stopped',
    steps: [
      { kind: 'press', selector: 'tag', target: 'open-card' },
      { kind: 'enter', redacted: false, selector: 'label', target: 'Name', value: 'Ada' },
    ],
  })

  Expect(StudioScenarioJourneyActive(recording)).toBe(false)
  Expect(StudioScenarioJourneyCanRecord(state, recording, true)).toBe(false)
  Expect(StudioScenarioJourneyCanRecord(state, 'null', true)).toBe(true)
  Expect(StudioScenarioJourneyCanRecord(state, 'null', false)).toBe(false)
  Expect(StudioScenarioJourneyCanSave(recording)).toBe(true)
  Expect(StudioScenarioJourneyCommand(recording)).toBe('scenario-start-journey')
  Expect(StudioScenarioJourneyLines(recording)).toEqual([
    'press #open-card',
    'enter "Ada" into label "Name"',
  ])
  Expect(StudioScenarioJourneyStatus(recording)).toContain('2 steps ready')
  Expect(JSON.parse(StudioScenarioJourneyPayload(state, true))).toEqual({
    captureSensitiveText: true,
    cellId: 'cell:states:phone',
    cellRevision: 3,
  })

  const redacted = JSON.stringify({
    ...JSON.parse(recording),
    steps: [{ kind: 'enter', redacted: true, selector: 'tag', target: 'password', value: '' }],
  })
  Expect(StudioScenarioJourneyCanSave(redacted)).toBe(false)
  Expect(StudioScenarioJourneyStatus(redacted)).toContain('Sensitive text was redacted')
})

Test('Tao-owned inspector layout drafts retain invalid text and emit only current typed actions', () => {
  const inspection = inspectorInspection()
  const selection = inspectorSelection()
  const initial = StudioInspectorLayoutDrafts(inspection)
  const invalid = StudioInspectorUpdateDraft(initial, 'gap', '')
  const valid = StudioInspectorUpdateDraft(initial, 'gap', '24')
  const named = StudioInspectorUpdateDraft(initial, 'gap', 'spacing.compact')
  const fixedWidth = StudioInspectorUpdateDraft(
    StudioInspectorUpdateDraft(initial, 'width-mode', 'fixed'),
    'width-value',
    '240',
  )

  Expect(JSON.parse(initial)).toMatchObject({
    alignment: 'left',
    content: 'spread stretch',
    gap: '8',
    'height-mode': 'fill',
    padding: 'horizontal 12 vertical 6',
    'width-mode': 'fixed',
    'width-value': '320',
  })
  Expect(StudioInspectorLayoutActionValid('source-1', inspection, selection, invalid, false, 'gap')).toBe(false)
  Expect(StudioInspectorLayoutActionValid('source-1', inspection, selection, valid, false, 'gap')).toBe(true)
  Expect(StudioInspectorLayoutActionValid('source-1', inspection, selection, named, false, 'gap')).toBe(true)
  Expect(StudioInspectorLayoutActionValid('source-1', inspection, selection, fixedWidth, false, 'width')).toBe(true)
  Expect(StudioInspectorLayoutActionValid('source-2', inspection, selection, valid, false, 'gap')).toBe(false)
  Expect(JSON.parse(StudioInspectorLayoutAction(inspection, selection, valid, 'gap'))).toEqual({
    entry: ['gap', 24],
    kind: 'set-layout-entry',
    renderId: '/workspace/Garden.tao:20:42',
  })
  Expect(JSON.parse(StudioInspectorLayoutAction(inspection, selection, named, 'gap'))).toEqual({
    entry: ['gap', 'spacing.compact'],
    kind: 'set-layout-entry',
    renderId: '/workspace/Garden.tao:20:42',
  })
  Expect(JSON.parse(StudioInspectorLayoutAction(inspection, selection, fixedWidth, 'width'))).toEqual({
    entry: ['width', 240],
    kind: 'set-layout-entry',
    renderId: '/workspace/Garden.tao:20:42',
  })
  Expect(JSON.parse(StudioInspectorLayoutAction(inspection, selection, initial, 'wrap-stack'))).toEqual({
    kind: 'wrap-render',
    renderId: '/workspace/Garden.tao:20:42',
    wrapper: 'Stack',
  })
})

Test('Tao-owned inspector style exposes provenance, edit-versus-fork, blast radius, and promotions', () => {
  const inspection = inspectorInspection()
  const selection = inspectorSelection()
  const drafts = StudioInspectorUpdateDraft(StudioInspectorStyleDrafts(inspection), 'value', '#0f0')
  const landings = StudioInspectorStyleFieldOptions(inspection, 'landing')
  const promotions = StudioInspectorStylePromotionIds(inspection)

  Expect(landings).toContain('Edit style card · affects 3')
  Expect(landings).toContain('Fork style card · selected render only')
  Expect(landings).toContain('Promote to Text default')
  Expect(landings).toContain('Promote to color token backgroundColor')
  Expect(StudioInspectorStyleActionValid('source-1', inspection, selection, drafts, false)).toBe(true)
  Expect(JSON.parse(StudioInspectorStyleAction(inspection, selection, drafts))).toMatchObject({
    entry: ['background', '#0f0'],
    kind: 'set-style-entry',
    landing: { bundleName: 'card', kind: 'style-bundle' },
  })
  Expect(StudioInspectorStyleNotes(inspection)[0]).toContain('affects 3 renders · editable')
  Expect(promotions.length).toBeGreaterThan(0)
  Expect(StudioInspectorStylePromotionLabel(inspection, promotions[0]!)).toContain('Promote background #c00')
  Expect(JSON.parse(StudioInspectorStylePromotionAction(inspection, selection, promotions[0]!))).toMatchObject({
    entry: ['background', '#c00'],
    kind: 'set-style-entry',
  })
  const sizePromotion = promotions.find(promotion =>
    StudioInspectorStylePromotionLabel(inspection, promotion).includes('size token')
  )
  Expect(sizePromotion).toBeDefined()
  Expect(JSON.parse(StudioInspectorStylePromotionAction(inspection, selection, sizePromotion!))).toMatchObject({
    entry: ['gap', 8],
    landing: { kind: 'size-token', tokenName: 'gapSize' },
  })

  const imported = JSON.stringify({
    ...JSON.parse(inspection),
    design: { editable: false, name: 'Shared', ownerPath: '/workspace/Theme.tao', reason: 'Imported design.' },
    styleProvenance: [{
      blastRadius: 9,
      chain: ['background #c00', 'card'],
      editable: false,
      landing: { bundleName: 'card', kind: 'style-bundle' },
      ownerPath: '/workspace/Theme.tao',
      reason: 'Imported design values are read-only.',
    }],
  })
  Expect(StudioInspectorStyleFieldOptions(imported, 'landing')).toEqual(['Element inline · selected render only'])
  Expect(StudioInspectorStyleNotes(imported).join('\n')).toContain('unavailable')
  Expect(StudioInspectorStyleNotes(imported).join('\n')).toContain('Imported design values are read-only.')
})

Test('Tao-owned inspector Data and Actions expose only the published active selection context', () => {
  const inspection = inspectorInspection()
  const selection = inspectorSelection()
  const lines = StudioInspectorDataLines(inspection, selection, 'cell-phone', 4, 'scenario-card')

  Expect(lines).toContain('Selected view: Main')
  Expect(lines).toContain('Selected element: Text')
  Expect(lines).toContain('Binding metadata: not published for this render.')
  Expect(lines).toContain('Datasource context: cell cell-phone revision 4.')
  Expect(lines).toContain('Entity tables are available in the Data panel.')
  Expect(StudioInspectorActionIds(inspection, selection)).toEqual([
    'wrap-row',
    'wrap-col',
    'wrap-stack',
    'remove-element',
  ])
  Expect(StudioInspectorActionLabel('wrap-col')).toBe('Wrap in Col')
  Expect(JSON.parse(StudioInspectorAction(selection, 'wrap-row'))).toEqual({
    kind: 'wrap-render',
    renderId: '/workspace/Garden.tao:20:42',
    wrapper: 'Row',
  })
  Expect(JSON.parse(StudioInspectorAction(selection, 'remove-element'))).toEqual({
    kind: 'remove-render',
    renderId: '/workspace/Garden.tao:20:42',
  })
  Expect(StudioInspectorActionValid('source-1', inspection, selection, false, 'remove-element')).toBe(true)
  Expect(StudioInspectorActionValid('source-1', inspection, selection, false, 'unknown')).toBe(false)
  Expect(StudioInspectorTextAvailable(inspection, selection)).toBe(false)
  Expect(StudioInspectorTextStatus(inspection, selection)).toContain('not a Text leaf')
  Expect(JSON.parse(StudioInspectorAction(selection, 'wrap-stack'))).toEqual({
    kind: 'wrap-render',
    renderId: '/workspace/Garden.tao:20:42',
    wrapper: 'Stack',
  })
})

Test('Tao-owned inspector Text section edits a literal and binds only offered values', () => {
  const selection = inspectorSelection()
  const inspection = JSON.stringify({
    ...JSON.parse(inspectorInspection()),
    text: {
      candidates: [
        { expression: 'Caption', type: 'text' },
        { expression: 'Story.Score', type: 'number' },
      ],
      expression: '"Meta"',
      literal: 'Meta',
    },
  })

  Expect(StudioInspectorTextAvailable(inspection, selection)).toBe(true)
  Expect(StudioInspectorTextStatus(inspection, selection)).toBe('Showing a literal.')
  Expect(StudioInspectorTextLiteral(inspection)).toBe('Meta')
  Expect(StudioInspectorTextCandidates(inspection)).toEqual(['Caption', 'Story.Score'])
  Expect(StudioInspectorTextBindingLabel(inspection, 'Caption')).toBe('Bind to Caption')
  Expect(StudioInspectorTextBindingLabel(inspection, 'Story.Score')).toBe('Bind to Story.Score (number)')
  Expect(StudioInspectorTextActionValid('source-1', inspection, selection, false)).toBe(true)
  Expect(StudioInspectorTextActionValid('source-2', inspection, selection, false)).toBe(false)
  Expect(StudioInspectorTextActionValid('source-1', inspection, selection, true)).toBe(false)
  Expect(JSON.parse(StudioInspectorSetTextAction(selection, 'Hello'))).toEqual({
    content: 'Hello',
    kind: 'set-text-content',
    renderId: '/workspace/Garden.tao:20:42',
  })
  Expect(JSON.parse(StudioInspectorBindTextAction(selection, 'Story.Score'))).toEqual({
    expression: 'Story.Score',
    kind: 'bind-text',
    renderId: '/workspace/Garden.tao:20:42',
  })
  const lines = StudioInspectorDataLines(inspection, selection, 'cell-phone', 4, 'scenario-card')
  Expect(lines).toContain('Text bindings: 2 values in scope; bind one in the Text section.')
  const bound = JSON.stringify({
    ...JSON.parse(inspection),
    text: { candidates: [], expression: 'Story.Title' },
  })
  Expect(StudioInspectorTextStatus(bound, selection)).toBe('Showing Story.Title.')
  Expect(StudioInspectorTextLiteral(bound)).toBe('')
})

Test('Tao-owned inspector drafts follow the inspected element instead of the first one seeded', () => {
  const selection = inspectorSelection()
  const inspection = inspectorInspection()
  const other = JSON.stringify({ ...JSON.parse(inspection), renderId: '/workspace/Garden.tao:30:8' })

  // Layout and Style drafts: typed values survive re-renders of the same element and reseed for another.
  const seeded = StudioInspectorDraftsFor('layout', inspection, '{}')
  const typed = StudioInspectorUpdateDraft(seeded, 'gap', '24')
  Expect(StudioInspectorDraft(typed, 'gap')).toBe('24')
  Expect(StudioInspectorDraftsFor('layout', inspection, typed)).toBe(typed)
  Expect(StudioInspectorDraft(StudioInspectorDraftsFor('layout', other, typed), 'gap'))
    .toBe(StudioInspectorDraft(StudioInspectorLayoutDrafts(other), 'gap'))
  Expect(StudioInspectorDraft(StudioInspectorDraftsFor('style', other, typed), 'value')).toBe(
    StudioInspectorDraft(StudioInspectorStyleDrafts(other), 'value'),
  )
  Expect(StudioInspectorDraftsFor('layout', '', typed)).toBe('{}')

  // Text drafts: the literal shows until something is typed for this very element.
  const literal = JSON.stringify({
    ...JSON.parse(inspection),
    text: { candidates: [], expression: '"Meta"', literal: 'Meta' },
  })
  Expect(StudioInspectorTextDraft(literal, '')).toBe('Meta')
  const draft = StudioInspectorTextUpdateDraft(literal, 'Hello')
  Expect(StudioInspectorTextDraft(literal, draft)).toBe('Hello')
  Expect(
    StudioInspectorTextDraft(
      JSON.stringify({ ...JSON.parse(other), text: { candidates: [], expression: '"X"', literal: 'X' } }),
      draft,
    ),
  )
    .toBe('X')
  Expect(StudioInspectorSetTextValid('source-1', literal, selection, false, draft)).toBe(true)
  Expect(
    StudioInspectorSetTextValid('source-1', literal, selection, false, StudioInspectorTextUpdateDraft(literal, '')),
  ).toBe(true)

  // A bound leaf is never replaced by an empty literal by accident.
  const bound = JSON.stringify({ ...JSON.parse(inspection), text: { candidates: [], expression: 'Story.Title' } })
  Expect(StudioInspectorTextDraft(bound, '')).toBe('')
  Expect(StudioInspectorSetTextValid('source-1', bound, selection, false, '')).toBe(false)
  Expect(
    StudioInspectorSetTextValid('source-1', bound, selection, false, StudioInspectorTextUpdateDraft(bound, 'Title')),
  ).toBe(true)
})

Test('Tao-owned inspector summary names the selection by project file and line, view, and element', () => {
  const content = 'use Text from @tao/ui\n\nview Main() {\n   render Text("Hi")\n}\n'
  Expect(StudioInspectorSummaryLines('source-1', inspectorInspection(), inspectorSelection(), content, 'Garden.tao'))
    .toEqual(['Source: Garden.tao:1–4', 'View: Main', 'Element: Text'])
  // Another open file, or a stale preview, still names the file and says the line waits for the refresh.
  Expect(StudioInspectorSummaryLines('source-1', inspectorInspection(), inspectorSelection(), content, 'Other.tao'))
    .toEqual(['Source: Garden.tao', 'View: Main', 'Element: Text'])
  Expect(StudioInspectorSummaryLines('source-2', inspectorInspection(), inspectorSelection(), content, 'Garden.tao'))
    .toEqual(['Source: Garden.tao', 'Waiting for the refreshed preview', 'View: Main', 'Element: Text'])
  Expect(StudioInspectorSummaryLines('', inspectorInspection(), inspectorSelection(), content, 'Garden.tao'))
    .toEqual(['Source: Garden.tao', 'Save the active draft to refresh source locations', 'View: Main', 'Element: Text'])
  Expect(StudioInspectorSummaryLines('source-1', '', '', content, 'Garden.tao'))
    .toEqual(['Select a rendered element in the preview.'])
})

function inspectorSelection(): string {
  return JSON.stringify({
    identity: {
      appName: 'Garden',
      occurrence: { nodeKind: 'render', renderOwner: 'Main' },
      path: '/workspace/Garden.tao',
      previewInstanceId: 'preview-1',
      project: '/workspace',
      sourceVersion: 'source-1',
    },
    range: { end: 42, start: 20 },
    renderId: '/workspace/Garden.tao:20:42',
  })
}

function inspectorInspection(): string {
  return JSON.stringify({
    design: { editable: true, name: 'Theme', ownerPath: '/workspace/Garden.tao' },
    elementName: 'Text',
    explorations: [['background', '#c00'], ['gap', 8]],
    layoutEntries: [
      ['gap', 8],
      ['pad', 'horizontal', 12, 'vertical', 6],
      ['width', 320],
      ['height', 'fill'],
      ['claim', 2],
      ['compress'],
      ['aligned', 'left'],
      ['content', 'spread', 'stretch'],
    ],
    renderId: '/workspace/Garden.tao:20:42',
    styleEntries: [['background', 'canvas']],
    styleProvenance: [{
      blastRadius: 3,
      chain: ['background #c00', 'background canvas'],
      landing: { bundleName: 'card', kind: 'style-bundle' },
      ownerPath: '/workspace/Garden.tao',
    }],
  })
}

function fileRowProps(overrides: Partial<TreeFileRowProps>): TreeFileRowProps {
  const action = noArgAction()
  return {
    BeginDelete: action,
    BeginRename: action,
    BeginMove: action,
    CancelDelete: action,
    CancelRename: action,
    ChangeRenamePath: textArgAction(),
    ChangeTargetPackage: textArgAction(),
    ConfirmDelete: false,
    Delete: action,
    DiagnosticCount: 2,
    Dirty: true,
    Name: 'Roadmap.tao',
    Move: action,
    Moving: false,
    Open: action,
    Path: 'Folder/Roadmap.tao',
    Rename: action,
    RenamePath: 'Folder/Roadmap.tao',
    Renaming: false,
    TargetPackage: '',
    ...overrides,
  }
}

function noArgAction(): TR.ActionValue<[]> {
  return { invoke() {} } as unknown as TR.ActionValue<[]>
}

function textArgAction(): TR.ActionValue<[TR.Value<string>]> {
  return { invoke() {} } as unknown as TR.ActionValue<[TR.Value<string>]>
}

type HostElement = React.ReactElement<Record<string, unknown>>

function elements(node: React.ReactNode): HostElement[] {
  if (Array.isArray(node)) {
    return node.flatMap(elements)
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) {
    return []
  }
  return [node, ...elements(node.props['children'] as React.ReactNode)]
}

function elementWith(root: React.ReactElement, name: string, value: unknown): HostElement {
  const found = elements(root).find(element => property(element, name) === value)
  Assert.defined(found, `a Studio product-host element with ${name}=${String(value)}`)
  return found
}

function property(element: React.ReactElement, name: string): unknown {
  return (element.props as Record<string, unknown>)[name]
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join('')
  }
  return React.isValidElement<Record<string, unknown>>(node)
    ? textContent(node.props['children'] as React.ReactNode)
    : ''
}

Test('Feed rows dispatch Tao selection and native drag preserves entity and field identity', () => {
  let selected = 0
  let transferred = ''
  let mime = ''
  let stopped = false
  let prevented = false
  const event = {
    dataTransfer: {
      effectAllowed: '',
      setData(type: string, value: string) {
        mime = type
        transferred = value
      },
    },
    stopPropagation() {
      stopped = true
    },
    preventDefault() {
      prevented = true
    },
  }
  const payload = '{"kind":"entity","entity":"Posts","rowId":"post:1"}'
  const row = StudioFeedRowControl({
    Payload: payload,
    Label: 'First post',
    Selected: true,
    Disabled: false,
    Select: {
      invoke() {
        selected++
      },
    } as unknown as TR.ActionValue<[]>,
  })
  ;(property(row, 'onClick') as () => void)()
  ;(property(row, 'onDragStart') as (event: unknown) => void)(event)
  Expect(selected).toBe(1)
  Expect(property(row, 'aria-pressed')).toBe(true)
  Expect(mime).toBe('application/x-tao-studio-feed')
  Expect(transferred).toBe(payload)
  Expect(event.dataTransfer.effectAllowed).toBe('copy')
  const fieldPayload = '{"kind":"field","entity":"Posts","rowId":"post:1","path":["title"],"presentation":"text"}'
  const chip = StudioFeedDrag({ Payload: fieldPayload, Label: 'Title', Disabled: false })
  ;(property(chip, 'onDragStart') as (event: unknown) => void)(event)
  Expect(transferred).toBe(fieldPayload)
  Expect(stopped).toBe(true)
  const disabled = StudioFeedDrag({ Payload: 'invalid', Label: 'Title', Disabled: true })
  ;(property(disabled, 'onDragStart') as (event: unknown) => void)(event)
  Expect(property(disabled, 'draggable')).toBe(false)
  Expect(prevented).toBe(true)
  Expect(transferred).toBe(fieldPayload)
})

Test('Feed selector adapters escape values into controller action payloads', () => {
  Expect(JSON.parse(StudioFeedEntityPayload('Posts'))).toEqual({ type: 'select-entity', entity: 'Posts' })
  Expect(JSON.parse(StudioFeedSourcePayload('Library'))).toEqual({ type: 'select-source', source: 'Library' })
  Expect(JSON.parse(StudioFeedSeedPayload('seed"\n'))).toEqual({ type: 'set-seed', seed: 'seed"\n' })
})

Test('Move to package defaults scenario relocation on and forwards checkbox choices to Tao state', () => {
  let chosen: boolean | undefined
  const row = TreeFileRow(fileRowProps({
    Moving: true,
    ChangeRelocateScenarios: {
      invoke(value: TR.Value<boolean>) {
        chosen = value.jsValue
      },
    } as unknown as TR.ActionValue<[TR.Value<boolean>]>,
  }))
  const checkbox = elementWith(row, 'type', 'checkbox')
  Expect(property(checkbox, 'checked')).toBe(true)
  Expect(textContent(row)).toContain('Move scenarios to app Scenarios.tao')
  ;(property(checkbox, 'onChange') as (event: unknown) => void)({ currentTarget: { checked: false } })
  Expect(chosen).toBe(false)
})
