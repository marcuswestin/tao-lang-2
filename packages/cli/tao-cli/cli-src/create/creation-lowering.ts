import { Assert, FS, Switch } from '@shared'
import { PROJECT_TSCONFIG } from '../app-modules'
import { deriveSchemeColors, type DesignColors } from './creation-colors'
import {
  appIdentifier,
  type CreationEntity,
  type CreationField,
  type CreationFieldType,
  type CreationPlan,
  type CreationSampleRow,
  derivedDeclarationNames,
  titleFieldOf,
} from './creation-plan'

/** CreationFiles maps project-relative paths to Tao source, before canonical formatting. */
export type CreationFiles = Record<string, string>

export type LowerCreationPlanOptions = {
  /** The description the plan came from, recorded in the app file for provenance. */
  description?: string
}

const TAB_ICONS = ['list.bullet', 'book', 'tray.full', 'star', 'tag', 'folder']
const COMMENT_WIDTH = 100
const PROJECT_GITIGNORE = [
  '# Operating system and editor files',
  '.DS_Store',
  '.idea/',
  '.vscode/',
  '',
  '# Tao generated sidecars',
  '*.tao.ts',
  '',
  '# Tooling output',
  'node_modules/',
  '.expo/',
  '*.tsbuildinfo',
  '*.log',
  '',
  '# Plain-text secrets',
  '.env',
  '.env.*',
  '',
].join('\n')

/**
 * lowerCreationPlan writes the canonical project layout for a validated plan: App, Data, Chrome, Design,
 * one feature folder per entity, Scenarios, the behavior tests, and the TypeScript project that
 * resolves `@tao/*` from the CLI-bundled modules. The model never authors Tao; every placement here
 * is Tao's.
 */
export function lowerCreationPlan(plan: CreationPlan, options: LowerCreationPlanOptions = {}): CreationFiles {
  const names = new ProjectNames(plan)
  const files: CreationFiles = {
    'App.tao': appFile(plan, names, options.description),
    'Data.tao': dataFile(plan, names),
    'Chrome.tao': chromeFile(plan, names),
    'Design.tao': designFile(plan, names),
    'Scenarios.tao': scenariosFile(plan, names),
    [`${names.app}.test.tao`]: testFile(plan, names),
    'tsconfig.json': PROJECT_TSCONFIG,
    '.gitignore': PROJECT_GITIGNORE,
    // The reserved root generated package exists from day one, committed empty, so Studio and the
    // compiler have their folder before the first generated file lands.
    '@/.gitkeep': '',
  }
  for (const entity of plan.entities) {
    files[`${entity.plural}/${entity.plural}.tao`] = featureFile(entity, names)
  }
  return files
}

/** writeCreationFiles writes lowered sources under `directory`, creating feature folders as needed. */
export async function writeCreationFiles(directory: string, files: CreationFiles): Promise<void> {
  for (const [relativePath, source] of Object.entries(files)) {
    await FS.writeText(FS.resolvePath(relativePath, directory), source)
  }
}

/** ProjectNames derives every generated declaration name once, so the files agree with each other. */
class ProjectNames {
  readonly app: string
  readonly navigator: string
  readonly design: string
  readonly handles: Map<string, string[]>

  constructor(readonly plan: CreationPlan) {
    this.app = appIdentifier(plan.name)
    this.navigator = `${this.app}Navigator`
    this.design = `${this.app}Design`
    this.handles = fixtureHandles(plan, this.app)
  }
}

// -- App.tao ---------------------------------------------------------------------------------------

function appFile(plan: CreationPlan, names: ProjectNames, description: string | undefined): string {
  const provenance = description === undefined || description.trim().length === 0
    ? ''
    : `//\n${commentLines(`Created by tao create from: ${description}`)}\n`
  return `use Local from @tao/data/providers/local

project {
   id ${taoString(plan.id)}
   name ${taoString(plan.name)}
   version "0.1.0"
   app ${names.app}
   remote none
}

${commentLines(`${plan.name}: ${plan.summary}`)}
${provenance}//
// This file holds the project and the app. The navigation is in Chrome.tao, the entities in
// Data.tao, the design in Design.tao, and each feature has its own folder.
app ${names.app} {
   Name ${taoString(plan.name)}
   Navigator ${names.navigator}
   Datasource Local {
      StorageKey ${taoString(plan.id)}
   }
   Design ${names.design}
}
`
}

// -- Data.tao --------------------------------------------------------------------------------------

function dataFile(plan: CreationPlan, _names: ProjectNames): string {
  const entities = plan.entities.map(entity => {
    const fields = entity.fields.map(field => `   ${fieldDeclaration(field)},`).join('\n')
    return `${commentLines(entity.purpose)}
package
data ${entity.plural} / ${entity.singular} {
${fields}

   order by ${orderField(entity).name},
}`
  })
  return `// The data catalog. Every entity the app stores is declared here, so what a row contains is
// readable on one page.

${entities.join('\n\n')}
`
}

function fieldDeclaration(field: CreationField): string {
  return Switch<CreationFieldType, string>(field.type, {
    text: () => field.title ? `${field.name} text (title)` : `${field.name} text (default "")`,
    number: () => `${field.name} number (default 0)`,
    yesno: () => `${field.name} yes / no`,
    time: () => `${field.name} time (default now)`,
  })
}

function orderField(entity: CreationEntity): CreationField {
  return entity.fields.find(field => field.type === 'time') ?? titleField(entity)
}

// -- Chrome.tao ------------------------------------------------------------------------------------

function chromeFile(plan: CreationPlan, names: ProjectNames): string {
  const featureImports = plan.entities.map(entity => `use ${listScene(entity)} from ./${entity.plural}`).join('\n')
  if (plan.entities.length === 1) {
    const entity = plan.entities[0]!
    return `use StackNav from @tao/nav
${featureImports}

// The shared navigation. A single stack today; a second feature turns this into a SelectionNav
// with one tab per feature.
folder
nav ${names.navigator} = StackNav {
   Initial ${listScene(entity)}
}
`
  }
  const stacks = plan.entities.map(entity =>
    `nav ${stackNav(entity)} = StackNav {
   Initial ${listScene(entity)}
}`
  ).join('\n\n')
  const tabs = plan.entities.map((entity, index) =>
    `   ${tabKey(entity)} {
      Label ${taoString(humanize(entity.plural))}
      Icon ${taoString(TAB_ICONS[index % TAB_ICONS.length]!)}
      Content ${stackNav(entity)}
   }`
  ).join('\n')
  return `use SelectionNav, StackNav from @tao/nav
${featureImports}

// The shared navigation: one tab per feature, each with its own stack.
${stacks}

folder
nav ${names.navigator} = SelectionNav {
   Initial ${tabKey(plan.entities[0]!)}
   Display "automatic"
${tabs}
}
`
}

// -- Design.tao ------------------------------------------------------------------------------------

function designFile(plan: CreationPlan, names: ProjectNames): string {
  const colors = deriveSchemeColors(plan.palette)
  const tokens = Object.keys(colors.light) as (keyof DesignColors)[]
  const raw = (scheme: 'light' | 'dark', suffix: string) =>
    tokens.map(token => `      ${token}${suffix} ${colors[scheme][token]}`).join('\n')
  const semantic = tokens.map(token => `      ${token} when Scheme is Dark ${token}Dark / not ${token}Light`).join('\n')
  return `// The design: a palette, element defaults, and the bundles the scenes apply at render sites.
folder
design ${names.design} {
   colors {
${raw('light', 'Light')}
${raw('dark', 'Dark')}

      // Every bundle spells these names, which follow the person's light or dark setting.
${semantic}
   }

   styles {
      Text [ink ink]
      TextInput [background surface, border line, ink ink, radius 12, size 16]
      FormButton [background accentStrong, background accent when pressed, ink onAccent, radius 12, weight 700]
      Checkbox [ink ink]
      AppSurface [background canvas]
      NavigationHost [background canvas]
      NavigationContent [background canvas]
      NavigationHeader [background surface, border line]
      NavigationTitle [size 18, weight 700, ink ink]
      NavigationTabs [gap 6, pad 6, background surface, border line]
      NavigationTab [pad 10, radius 10, ink inkMuted, weight 600, background accentSoft when selected, ink accentStrong when selected]
      NavigationChromeButton [pad 8, radius 8, ink accentStrong, weight 600]

      screen [fill, content top stretch, pad 24, background canvas]
      column [width max 720, gap 16]
      eyebrow [size 13, line 18, weight 700, ink accentStrong]
      sectionTitle [size 20, line 26, weight 700, ink ink]
      body [size 16, line 24, ink inkMuted]
      caption [size 14, line 20, ink inkMuted]
      panel [gap 14, pad 20, radius 18, background surface, border line]
      card [gap 10, pad 16, radius 14, background surface, border line]
      buttonSecondary [background surface, border line, ink accentStrong]
      buttonDanger [background dangerSoft, border danger, ink danger]
   }
}
`
}

// -- <Plural>/<Plural>.tao -------------------------------------------------------------------------

function featureFile(entity: CreationEntity, _names: ProjectNames): string {
  const title = titleField(entity)
  const singular = entity.singular
  const lower = lowerFirst(singular)
  const singularWords = humanize(singular).toLowerCase()
  const pluralWords = humanize(entity.plural)
  const draft = `New${title.name}`
  const textFields = entity.fields.filter(field => field.type === 'text' && !field.title)
  const numberFields = entity.fields.filter(field => field.type === 'number')
  const flagFields = entity.fields.filter(field => field.type === 'yesno')
  const uiViews = ['Col', 'ScrollView', 'Spinner', 'Text', 'TextInput', 'TextMultiline']
  if (flagFields.length > 0) {
    uiViews.unshift('Checkbox')
  }

  const rowFlags = flagFields.map(field =>
    `      if ${singular}.${field.name} is ${field.name} {
         Text(${taoString(humanize(field.name).toUpperCase())}) [eyebrow]
      }`
  )
  const rowCaptions = [
    ...textFields.map(field => `      Text(${singular}.${field.name}) [caption]`),
    ...numberFields.map(field =>
      `      Text(${taoString(`${humanize(field.name)}: { ${singular}.${field.name} }`)}) [caption]`
    ),
  ]

  const editableFields = [title, ...textFields]
  const draftStates = editableFields.map(field => `   state ${field.name}Draft = ${singular}.${field.name}`)
  const saveUpdates = editableFields.map(field => `         ${field.name}: ${field.name}Draft`)
  const flagActions = flagFields.map(field =>
    `   action Set${field.name}(Value boolean) {
      update ${singular} {
         ${field.name}: Value
      }
   }`
  )
  const detailInputs = editableFields.map(field => `
         #${lower}${field.name}Draft
         TextInput(Value: ${field.name}Draft, Label: ${taoString(humanize(field.name))}, Placeholder: ${
    taoString(humanize(field.name))
  }) {
            on submit Save${singular}
         }`)
  const detailNumbers = numberFields.map(field =>
    `\n         Text(${taoString(`${humanize(field.name)}: { ${singular}.${field.name} }`)}) [body]`
  )
  const detailFlags = flagFields.map(field => `
         #${lower}${field.name}
         Checkbox(Value: ${singular}.${field.name} is ${field.name}, Label: ${taoString(humanize(field.name))}) {
            on change Set${field.name}
         }`)

  return `use ${uiViews.join(', ')} from @tao/ui
use FormButton from @tao/ui/basic
use ${[entity.plural, entity.singular].sort().join(', ')} from ..

${
    commentLines(
      `The ${pluralWords.toLowerCase()} feature: the list a person lands on, one row of it, and the detail of one ${singularWords}.`,
    )
  }
package
scene ${listScene(entity)}() {
   Title ${taoString(pluralWords)}
   state ${draft} = ""
   query ${entity.plural} { }
   action Add${singular}() {
      check ${draft} is not empty
      create ${singular} {
         ${title.name}: ${draft}
      }
      set ${draft} = ""
   }
   command New${singular}() {
      Title ${taoString(`Add ${singularWords}`)}
      Icon "plus"
      Enabled ${draft} is not empty
      do Add${singular}()
   }
   Toolbar { New${singular} }
   render ScrollView() [screen] {
      Col() [column] {
         Col() [panel] {
            Text(${taoString(`NEW ${humanize(singular).toUpperCase()}`)}) [eyebrow]

            #${lower}${title.name}
            TextInput(Value: ${draft}, Label: ${taoString(humanize(title.name))}, Placeholder: ${
    taoString(`New ${singularWords} ${humanize(title.name).toLowerCase()}`)
  }) {
               on submit Add${singular}
            }

            #add${singular}
            FormButton(${taoString(`Add ${singularWords}`)}, Disabled: ${draft} is empty) {
               on press Add${singular}
            }
         }
         guard ${entity.plural} {
            loading -> { Spinner() }
            error -> Message {
               Text(${taoString(`${pluralWords} could not be loaded`)}) [sectionTitle]
               TextMultiline(Message) [body]
            }
         }
         guard ${entity.plural} empty -> {
            Col() [panel] {
               Text(${taoString(`No ${pluralWords.toLowerCase()} yet`)}) [sectionTitle]
               TextMultiline("Add the first one above.") [body]
            }
         }

         #${lowerFirst(entity.plural)}
         loop ${entity.plural} / ${singular} {
            ${rowView(entity)}(${singular})
            on select -> { present ${detailScene(entity)}(${singular}) }
         }
      }
   }
}

${commentLines(`One ${singularWords} in the list.`)}
package
view ${rowView(entity)}(${singular}) {
   render Col() [card] {
${[...rowFlags, `      Text(${singular}.${title.name}) [sectionTitle]`, ...rowCaptions].join('\n')}

      #open${singular}
      FormButton("Open") [buttonSecondary] {
         on press -> { present ${detailScene(entity)}(${singular}) }
      }
   }
}

${commentLines(`One ${singularWords}: edit its fields or delete it.`)}
package
scene ${detailScene(entity)}(${singular}) {
   Title ${singular}.${title.name}
${draftStates.join('\n')}
   action Save${singular}() {
      check ${title.name}Draft is not empty
      update ${singular} {
${saveUpdates.join('\n')}
      }
   }
${flagActions.map(action => `${action}\n`).join('')}   action Delete${singular}() {
      delete ${singular}
      dismiss
   }
   command Save${singular}Command() {
      Title ${taoString(`Save ${singularWords}`)}
      Icon "checkmark"
      Enabled ${title.name}Draft is not empty
      do Save${singular}()
   }
   Toolbar { Save${singular}Command }
   render ScrollView() [screen] {
      Col() [column, panel] {
         Text(${taoString(humanize(singular).toUpperCase())}) [eyebrow]
         guard ${singular} {
            loading -> { Spinner() }
            missing -> { TextMultiline(${taoString(`This ${singularWords} no longer exists.`)}) [body] }
            error -> Message { TextMultiline(${
    taoString(`The ${singularWords} could not be loaded: { Message }`)
  }) [body] }
         }
${detailInputs.join('\n')}${detailNumbers.join('')}${detailFlags.join('\n')}

         #save${singular}
         FormButton(${taoString(`Save ${singularWords}`)}, Disabled: ${title.name}Draft is empty) {
            on press Save${singular}
         }

         #delete${singular}
         FormButton(${taoString(`Delete ${singularWords}`)}) [buttonDanger] {
            on press Delete${singular}
         }
      }
   }
}
`
}

// -- Scenarios.tao ---------------------------------------------------------------------------------

function scenariosFile(plan: CreationPlan, names: ProjectNames): string {
  const rowImports = plan.entities.map(entity => `use ${rowView(entity)} from ./${entity.plural}`).join('\n')
  const bindings = plan.entities.flatMap(entity => {
    const handles = names.handles.get(entity.plural) ?? []
    return (plan.samples[entity.plural] ?? []).map((row, index) => {
      const fields = fixtureFields(entity, row).map(field => `      ${field}`).join('\n')
      return `   ${handles[index]!} = create ${entity.singular} {
${fields}
   }`
    })
  })
  const rowGroups = plan.entities.map(entity => {
    const handles = (names.handles.get(entity.plural) ?? []).slice(0, 2)
    const scenarios = handles.map(handle =>
      `   scenario ${taoString(lowerFirst(handle))} {
      render (${entity.singular}: ${handle})
   }`
    ).join('\n')
    return `scenarios ${rowView(entity)} ${taoString(`${humanize(entity.plural).toLowerCase()} states`)} {
   fixture Sample
   device phone
   appearance light
   network online
   locale "en"
${scenarios}
}`
  })
  return `use ${[names.app, ...plan.entities.map(entity => entity.singular)].sort().join(', ')} from ./
${rowImports}

// Deterministic data for Studio previews and the device matrix.
fixture Sample {
${bindings.join('\n')}
}

scenarios ${names.app} "devices" {
   fixture Sample
   scenario "phone" {
      device phone
      appearance light
      network online
      locale "en"
   }
   scenario "tabletDark" {
      device tablet 1024 x 1366
      appearance dark
      network online
      locale "en"
   }
}

${rowGroups.join('\n\n')}
`
}

function fixtureFields(entity: CreationEntity, row: CreationSampleRow): string[] {
  return entity.fields.flatMap(field => {
    const value = row[field.name]
    if (value === undefined || field.type === 'time') {
      return []
    }
    if (typeof value === 'string') {
      return [`${field.name}: ${taoString(value)}`]
    }
    return [`${field.name}: ${String(value)}`]
  })
}

/** fixtureHandles names each sample row after its title, unique across the fixture and the project. */
function fixtureHandles(plan: CreationPlan, app: string): Map<string, string[]> {
  const taken = new Set<string>([
    app,
    'Sample',
    ...plan.entities.flatMap(entity => [entity.plural, entity.singular, ...derivedDeclarationNames(entity)]),
  ])
  const handles = new Map<string, string[]>()
  for (const entity of plan.entities) {
    const title = titleField(entity)
    const names: string[] = []
    for (const row of plan.samples[entity.plural] ?? []) {
      const base = pascalWords(String(row[title.name] ?? '')) || `${entity.singular}Row`
      const legalStem = /^[0-9]/u.test(base) ? `Row${base}` : base
      let candidate = legalStem
      for (let suffix = 2; taken.has(candidate); suffix += 1) {
        candidate = `${legalStem}${suffix}`
      }
      taken.add(candidate)
      names.push(candidate)
    }
    handles.set(entity.plural, names)
  }
  return handles
}

// -- <App>.test.tao --------------------------------------------------------------------------------

function testFile(plan: CreationPlan, names: ProjectNames): string {
  const journeys = plan.entities.map((entity, index) => {
    const title = titleField(entity)
    const lower = lowerFirst(entity.singular)
    const singularWords = humanize(entity.singular).toLowerCase()
    const pluralWords = humanize(entity.plural)
    const first = String(plan.samples[entity.plural]![0]![title.name])
    const renamed = `${first} (updated)`
    const openTab = index === 0 ? '' : `\n      press ${taoString(pluralWords)}`
    return `   test ${taoString(`adds a ${singularWords}, opens it, and renames it`)} {
      run ${names.app}${openTab}
      expect text ${taoString(`No ${pluralWords.toLowerCase()} yet`)}
      enter ${taoString(first)} into #${lower}${title.name}
      press #add${entity.singular}
      expect missing text ${taoString(`No ${pluralWords.toLowerCase()} yet`)}
      select #${lowerFirst(entity.plural)}[1] {
         expect text ${taoString(first)}
         press #open${entity.singular}
      }
      expect navigation title ${taoString(first)}
      enter ${taoString(renamed)} into #${lower}${title.name}Draft
      press #save${entity.singular}
      expect navigation title ${taoString(renamed)}
      back
      expect text ${taoString(renamed)}
   }`
  })
  const firstEntity = plan.entities[0]!
  const firstTitle = titleField(firstEntity)
  const firstValue = String(plan.samples[firstEntity.plural]![0]![firstTitle.name])
  journeys.push(`   test ${taoString(`keeps ${humanize(firstEntity.plural).toLowerCase()} across a relaunch`)} {
      run ${names.app}
      enter ${taoString(firstValue)} into #${lowerFirst(firstEntity.singular)}${firstTitle.name}
      press #add${firstEntity.singular}
      relaunch
      expect text ${taoString(firstValue)}
   }`)
  return `use ${names.app} from ./

test ${taoString(plan.name)} {
${journeys.join('\n')}
}
`
}

// -- Naming ----------------------------------------------------------------------------------------

function listScene(entity: CreationEntity): string {
  return `${entity.singular}List`
}

function detailScene(entity: CreationEntity): string {
  return `${entity.singular}Detail`
}

function rowView(entity: CreationEntity): string {
  return `${entity.singular}Row`
}

function stackNav(entity: CreationEntity): string {
  return `${entity.plural}Stack`
}

function tabKey(entity: CreationEntity): string {
  return `@${lowerFirst(entity.plural)}`
}

function titleField(entity: CreationEntity): CreationField {
  const field = titleFieldOf(entity)
  Assert.defined(field, `entity ${entity.plural} to have one title field; the plan is validated before lowering`)
  return field
}

/** humanize turns PascalCase into sentence case words: `CreatedAt` reads `Created at`. */
export function humanize(identifier: string): string {
  const spaced = identifier.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
  const lowered = spaced.toLowerCase()
  return lowered[0]!.toUpperCase() + lowered.slice(1)
}

function lowerFirst(identifier: string): string {
  return identifier[0]!.toLowerCase() + identifier.slice(1)
}

function pascalWords(text: string): string {
  return text.normalize('NFKD').replace(/[^A-Za-z0-9\s]/gu, ' ').split(/\s+/u).filter(word => word.length > 0)
    .map(word => word[0]!.toUpperCase() + word.slice(1)).join('')
}

function taoString(value: string): string {
  return JSON.stringify(value)
}

/** commentLines wraps prose into `//` lines no wider than the repository's comment width. */
function commentLines(text: string): string {
  const words = text.replace(/\s+/gu, ' ').trim().split(' ')
  const lines: string[] = []
  let current = '//'
  for (const word of words) {
    if (current.length + 1 + word.length > COMMENT_WIDTH && current !== '//') {
      lines.push(current)
      current = '//'
    }
    current = `${current} ${word}`
  }
  lines.push(current)
  return lines.join('\n')
}
