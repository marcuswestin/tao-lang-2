import { Assert, FS, ReleaseCapabilities, type ReleaseProfile, Switch } from '@shared'
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
import { projectStarterRelease } from './release-starter-projection'

/** CreationFiles maps project-relative paths to Tao source, before canonical formatting. */
export type CreationFiles = Record<string, string>

export type LowerCreationPlanOptions = {
  /** Internal builds and tests select a profile; public commands use their build stamp. */
  releaseProfile?: ReleaseProfile
  /** The description the plan came from, recorded in the app file for provenance. */
  description?: string
  provider?: 'firebase'
  validationTools?: boolean
}

const TAB_ICONS = ['list.bullet', 'book', 'tray.full', 'star', 'tag', 'folder']
const COMMENT_WIDTH = 100

/**
 * lowerCreationPlan writes the canonical project layout for a validated plan: App, Data, Chrome, Design,
 * one feature folder per entity, Scenarios, the behavior tests, and the TypeScript project that
 * resolves `@tao/*` from the CLI-bundled modules. The model never authors Tao; every placement here
 * is Tao's.
 */
export function lowerCreationPlan(plan: CreationPlan, options: LowerCreationPlanOptions = {}): CreationFiles {
  Assert.input(
    !options.validationTools || options.provider === 'firebase',
    'Validation tools require Firebase creation.',
  )
  if (options.provider === 'firebase') {
    ReleaseCapabilities.require('auth', options.releaseProfile)
    ReleaseCapabilities.require('hosted-data', options.releaseProfile)
    const issue = firebaseCreationIssue(plan)
    Assert.input(issue === undefined, issue ?? 'Firebase creation name collision.')
  }
  const names = new ProjectNames(plan)
  const firebase = options.provider === 'firebase'
  const files: CreationFiles = {
    'App.tao': appFile(plan, names, options.description, firebase),
    'Data.tao': dataFile(plan, names, firebase),
    'Chrome.tao': chromeFile(plan, names),
    'Design.tao': designFile(plan, names, options.releaseProfile),
    'Scenarios.tao': firebase ? firebaseScenariosFile(names) : scenariosFile(plan, names),
    [`${names.app}.test.tao`]: testFile(plan, names, firebase, options.validationTools === true),
    'tsconfig.json': PROJECT_TSCONFIG,
    '.gitignore':
      '/.tao-ts/\n/.tao/*\n!/.tao/.gitkeep\n!/.tao/project.json\n!/.tao/lock.jsonc\n!/.tao/skills.version\nnode_modules/\n',
    '.tao/.gitkeep': '',
    // The reserved root generated package exists from day one, committed empty, so Studio and the
    // compiler have their folder before the first generated file lands.
    '@/.gitkeep': '',
  }
  if (firebase) {
    files['Auth.tao'] = firebaseAuthFile(plan, names, options.validationTools === true)
    files['README.md'] = firebaseReadme(plan, options.validationTools === true)
  }
  for (const entity of plan.entities) {
    files[`${entity.plural}/${entity.plural}.tao`] = featureFile(entity, names, firebase)
  }
  return projectStarterRelease(files, options.releaseProfile)
}

export function firebaseCreationIssue(plan: CreationPlan): string | undefined {
  const app = appIdentifier(plan.name)
  const reserved = new Set([
    'Accounts',
    'Account',
    'Firebase',
    'FirebaseAuth',
    `${app}AuthNavigator`,
    `${app}AccountGate`,
    `${app}SignIn`,
  ])
  const collision = reserved.has(app) ? app : plan.entities
    .flatMap(entity => [entity.plural, entity.singular, ...derivedDeclarationNames(entity)])
    .find(name => reserved.has(name))
  if (collision !== undefined) {
    return `Firebase creation reserves ${collision} for the signed-in account; rename the app or entity.`
  }
  return undefined
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

function variantAppId(id: string, variant: string): string {
  return `${id.slice(0, 63 - variant.length).replace(/-+$/u, '')}-${variant}`
}

// -- App.tao ---------------------------------------------------------------------------------------

function appFile(plan: CreationPlan, names: ProjectNames, description: string | undefined, firebase: boolean): string {
  const provenance = description === undefined || description.trim().length === 0
    ? ''
    : `//\n${commentLines(`Created by tao create from: ${description}`)}\n`
  const imports = firebase
    ? `use FirebaseAuth from @tao/auth/firebase
use Firebase from @tao/data/providers/firebase
use ${names.app}AuthNavigator from ./Auth`
    : 'use Local from @tao/data/providers/local'
  const connection = firebase
    ? `   Auth FirebaseAuth {
      ApiKey "REPLACE_WITH_FIREBASE_API_KEY"
      ProjectId "REPLACE_WITH_FIREBASE_PROJECT_ID"
   }
   Datasource Firebase {
      ApiKey "REPLACE_WITH_FIREBASE_API_KEY"
      ProjectId "REPLACE_WITH_FIREBASE_PROJECT_ID"
      StorageKey ${taoString(plan.id)}
   }`
    : `   Datasource Local {
      StorageKey ${taoString(plan.id)}
   }`
  return `${imports}

${commentLines(`${plan.name}: ${plan.summary}`)}
${provenance}//
// This file holds the app. The navigation is in Chrome.tao, the entities in
// Data.tao, the design in Design.tao, and each feature has its own folder.
app ${names.app} {
   id ${taoString(plan.id)}
   version "0.1.0"
   name ${taoString(plan.name)}
   Navigator ${firebase ? `${names.app}AuthNavigator` : names.navigator}
${connection}
   Design ${names.design}
}
`
}

// -- Data.tao --------------------------------------------------------------------------------------

function dataFile(plan: CreationPlan, _names: ProjectNames, firebase: boolean): string {
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

${firebase ? 'package\ndata Accounts / Account {\n   DisplayName text,\n}\n\n' : ''}${entities.join('\n\n')}
`
}

function firebaseAuthFile(plan: CreationPlan, names: ProjectNames, validationTools: boolean): string {
  const featureImports = plan.entities.map(entity => `use ${listScene(entity)} from ./${entity.plural}`).join('\n')
  const selections = plan.entities.length === 1
    ? `                  ${listScene(plan.entities[0]!)}()`
    : `                  Row() {
${
      plan.entities.map(entity =>
        `                     FormButton(${taoString(humanize(entity.plural))}) {
                        on press -> { set Active = ${taoString(entity.plural)} }
                     }`
      ).join('\n')
    }
                  }
${
      plan.entities.map(entity =>
        `                  if Active == ${taoString(entity.plural)} {
                     ${listScene(entity)}()
                  }`
      ).join('\n')
    }`
  const validationAction = validationTools
    ? `   // TODO: Remove this synthetic validation shortcut after hosted acceptance.
   action FillValidationCredentials() {
      set Flow.Email = "tao-hosted-validation@example.test"
      set Flow.Password = "Tao-validation-only-2026!"
   }
`
    : ''
  const validationButton = validationTools
    ? `      #fillValidationCredentials
      FormButton("Fill validation credentials") {
         on press FillValidationCredentials
      }
`
    : ''
  return `use Account, Session, SignInFlow, SignOut from @tao/auth
use StackNav from @tao/nav
use Col, Row, Text, TextInput, TextMultiline from @tao/ui
use FormButton from @tao/ui/basic
${featureImports}

folder
nav ${names.app}AuthNavigator = StackNav {
   Initial ${names.app}AccountGate
}

scene ${names.app}AccountGate() {
   Title ${taoString(plan.name)}
${plan.entities.length === 1 ? '' : `   state Active = ${taoString(plan.entities[0]!.plural)}\n`}   action Leave() {
      do SignOut()
   }
   render Col() [fill] {
      when Session.State
         | SignedIn -> {
            #signOut
            FormButton("Sign out") {
               on press Leave
            }
            when Account {
               loading -> Text("Opening account…")
               missing -> Text("Account data is missing")
               unauthorized -> Text("You do not have access")
               error -> Text("Account data could not be loaded")
               otherwise -> {
${selections}
               }
            }
         }
         | Restoring -> Text("Restoring session…")
         | otherwise -> ${names.app}SignIn()
   }
}

view ${names.app}SignIn() {
   state Flow = SignInFlow()
   action ExistingAccount() {
      set Flow.Registration = false
      do Flow.Submit()
   }
   action CreateAccount() {
      set Flow.Registration = true
      do Flow.Submit()
   }
${validationAction}   render Col() [fill] {
      Text(${taoString(`Sign in to ${plan.name}`)})
      #email
      TextInput(Value: Flow.Email, Label: "Email") {
         on submit ExistingAccount
      }
      #password
      TextInput(Value: Flow.Password, Label: "Password", Secure: true) {
         on submit ExistingAccount
      }
      #signIn
      FormButton("Sign in", Disabled: Flow.Running) {
         on press ExistingAccount
      }
      #createAccount
      FormButton("Create account", Disabled: Flow.Running) {
         on press CreateAccount
      }
      if Flow.Problem is not empty {
         TextMultiline(Flow.Problem)
      }
${validationButton}   }
}
`
}

function firebaseReadme(plan: CreationPlan, validationTools: boolean): string {
  return `# ${plan.name}

This app stores each signed-in account's data in a private Firebase store. Set up a Firebase
project with Email/Password sign-in and Firestore before running the app.

From this project directory:

1. Run \`tao connect firebase .\` to save the public connection settings locally in
   \`.tao/local/connections.json\`. The checked-in placeholders in \`App.tao\` are overridden locally.
2. Run \`tao firebase generate . --app ${appIdentifier(plan.name)} --output .tao/firebase-backend\`.
   Review and combine those rules with any existing rules in that Firebase project before deploying:
   a Firestore rules deployment replaces the project's current rules. Generation does not deploy.
3. Run \`tao run . --app ${appIdentifier(plan.name)}\` and sign in or create an account.

Run \`tao test .\` for the local Memory/TestAuth journeys. They do not contact Firebase.
${
    validationTools
      ? '\nThe Fill validation credentials button only fills synthetic example values and never submits. Remove it after hosted validation.\n'
      : ''
  }
`
}

function firebaseScenariosFile(names: ProjectNames): string {
  return `use Memory from @tao/data/providers/memory
use ${names.navigator} from ./Chrome
use ${names.design} from ./Design

app ${names.app}Preview {
   id ${taoString(variantAppId(names.plan.id, 'preview'))}
   version "0.1.0"
   name ${taoString(`${names.plan.name} Preview`)}
   Datasource Memory { }
   Navigator ${names.navigator}
   Design ${names.design}
}

scenarios ${names.app}Preview "devices" {
   scenario "phone" {
      device phone
      appearance light
      network online
      locale "en"
   }
}
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

function designFile(plan: CreationPlan, names: ProjectNames, releaseProfile?: ReleaseProfile): string {
  const colors = deriveSchemeColors(plan.palette)
  const tokens = Object.keys(colors.light) as (keyof DesignColors)[]
  const raw = (scheme: 'light' | 'dark', suffix: string) =>
    tokens.map(token => `      ${token}${suffix} ${colors[scheme][token]}`).join('\n')
  const semantic = tokens.map(token => `      ${token} when Scheme is Dark ${token}Dark / not ${token}Light`).join('\n')
  // Scheme-conditional colors and value paths are advanced design, so an early release names one palette.
  const palette = ReleaseCapabilities.allows('advanced-design', releaseProfile)
    ? `${raw('light', 'Light')}
${raw('dark', 'Dark')}

      // Every bundle spells these names, which follow the person's light or dark setting.
${semantic}`
    : `      // Every bundle spells these names.
${raw('light', '')}`
  return `// The design: a palette and the bundles the scenes apply at render sites.
folder
design ${names.design} {
   colors {
${palette}
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
      column [width max 720, gap 16, centered]
      eyebrow [size 13, line 18, weight 700, ink accentStrong]
      sectionTitle [size 20, line 26, weight 700, ink ink]
      body [size 16, line 24, ink inkMuted]
      caption [size 14, line 20, ink inkMuted]
      panel [hug, gap 14, pad 20, radius 18, background surface, border line]
      card [hug, gap 10, pad 16, radius 14, background surface, border line]
      buttonSecondary [background surface, border line, ink accentStrong]
      buttonDanger [background dangerSoft, border danger, ink danger]
   }
}
`
}

// -- <Plural>/<Plural>.tao -------------------------------------------------------------------------

function featureFile(entity: CreationEntity, _names: ProjectNames, firebase: boolean): string {
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
${firebase ? 'view' : 'scene'} ${listScene(entity)}() {
${firebase ? '' : `   Title ${taoString(pluralWords)}\n`}   state ${draft} = ""
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
${firebase ? '' : `   Toolbar { New${singular} }\n`}   render ScrollView() [screen] {
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
            error -> Context {
               Text(${taoString(`${pluralWords} could not be loaded`)}) [sectionTitle]
               TextMultiline(Context.Message) [body]
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
            error -> Context { TextMultiline(${
    taoString(`The ${singularWords} could not be loaded: { Context.Message }`)
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

function testFile(plan: CreationPlan, names: ProjectNames, firebase: boolean, validationTools: boolean): string {
  const journeys = plan.entities.map((entity, index) => {
    const title = titleField(entity)
    const lower = lowerFirst(entity.singular)
    const singularWords = humanize(entity.singular).toLowerCase()
    const pluralWords = humanize(entity.plural)
    const first = String(plan.samples[entity.plural]![0]![title.name])
    const renamed = `${first} (updated)`
    const openTab = index === 0 ? '' : `\n      press ${taoString(pluralWords)}`
    return `   test ${taoString(`adds a ${singularWords}, opens it, and renames it`)} {
      run ${firebase ? `${names.app}Test` : names.app}${openTab}
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
  if (firebase) {
    const validationJourney = validationTools
      ? `   test "fills validation credentials without signing in" {
      run ${names.app}SignInTest
      expect text ${taoString(`Sign in to ${plan.name}`)}
      press #fillValidationCredentials
      expect input label "Email" value "tao-hosted-validation@example.test"
      expect input label "Password" value "Tao-validation-only-2026!"
      expect text ${taoString(`Sign in to ${plan.name}`)}
   }
`
      : ''
    return `use TestAuth from @tao/auth/testing
use Memory from @tao/data/providers/memory
use ${names.app}AuthNavigator from ./Auth
use ${names.navigator} from ./Chrome
use ${names.design} from ./Design

app ${names.app}Test {
   id ${taoString(variantAppId(plan.id, 'memory-test'))}
   version "0.1.0"
   name ${taoString(`${plan.name} Memory Test`)}
   Datasource Memory { }
   Navigator ${names.navigator}
   Design ${names.design}
}

app ${names.app}SignInTest {
   id ${taoString(variantAppId(plan.id, 'sign-in-test'))}
   version "0.1.0"
   name ${taoString(`${plan.name} Sign In Test`)}
   Auth TestAuth { }
   Datasource Memory { }
   Navigator ${names.app}AuthNavigator
   Design ${names.design}
}

app ${names.app}SignOutTest {
   id ${taoString(variantAppId(plan.id, 'sign-out-test'))}
   version "0.1.0"
   name ${taoString(`${plan.name} Sign Out Test`)}
   Auth TestAuth { State "SignedIn" }
   Datasource Memory { }
   Navigator ${names.app}AuthNavigator
   Design ${names.design}
}

test ${taoString(plan.name)} {
${validationJourney}   test "signs in with an existing account" {
      run ${names.app}SignInTest
      enter "reader@example.test" into #email
      enter "local-test-password" into #password
      press #signIn
      expect missing text ${taoString(`Sign in to ${plan.name}`)}
      press #signOut
      expect text ${taoString(`Sign in to ${plan.name}`)}
   }
   test "creates an account" {
      run ${names.app}SignInTest
      enter "new-reader@example.test" into #email
      enter "local-test-password" into #password
      press #createAccount
      expect missing text ${taoString(`Sign in to ${plan.name}`)}
      press #signOut
      expect text ${taoString(`Sign in to ${plan.name}`)}
   }
   test "signs out" {
      run ${names.app}SignOutTest
      press #signOut
      expect text ${taoString(`Sign in to ${plan.name}`)}
   }
${journeys.join('\n')}
}
`
  }
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
