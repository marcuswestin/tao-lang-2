import { Diagnostics } from '@shared'
import { Describe, Expect, stubView, Test } from '@shared/test'
import { InteractionValidator } from '../validator-src/validators/interaction-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, acceptsFiles, rejects, rejectsFiles, stubContainer, testValidateCode } from './test-validate'

const leaf = stubView('Leaf')
const messages = InteractionValidator.messages

const commandFixture = `
  ${leaf}
  action Run() { }
  data Documents / Document { Title text }
  data Workspaces / Workspace { Name text }
  command Finish(Document) { Title "Finish" Key "f" do Run() }
  command Duplicate(Document) { Title "Duplicate" Key "d" do Run() }
  command Delete(Document) { Title "Delete" Key "x" do Run() }
  command NewWorkspace(Workspace) { Title "New workspace" Key "n" do Run() }
`

Describe('validator: interaction attention', () => {
  Test(
    'accepts entity policy, view promotion and exclusion, and every decided condition',
    accepts(`
      ${leaf}
      action Run() { }
      data Documents / Document {
        Title text,
        commands { Finish },
        commands hide { Delete }
      }
      command Finish(Document) { Title "Finish" Key "f" do Run() }
      command Duplicate(Document) { Title "Duplicate" Key "d" do Run() }
      command Delete(Document) { Title "Delete" Key "x" do Run() }
      ${stubContainer('Panel')}
      view Shell(Navigator nav) {
        render Panel() {
          Navigator()
          Sidebar()
        }
      }
      view Sidebar() { render Leaf() [rigid when Sidebar is active] }
      view Row(Document) {
        Commands { Finish, Duplicate }
        hide Delete
        render Leaf() [fill when pressed, hug when focused, compress when hovered,
          rigid when selected, centered when Scheme is Dark]
      }
    `),
  )

  Test(
    'accepts exact reachable region members and rejects tags, orphans, and private sibling identities',
    async () => {
      await acceptsFiles({
        'Main.tao': `
          ${stubContainer('Panel')}
          view Shell(Navigator nav) {
            render Panel() {
              Navigator()
              Sidebar()
            }
          }
        `,
        'Sidebar.tao': `
          ${leaf}
          folder view Sidebar() { render Leaf() [rigid when Sidebar is active] }
        `,
      })()
      await rejects(
        `
          ${leaf}
          ${stubContainer('Panel')}
          view Home() {
            render Panel() {
              #Sidebar
              Leaf()
              Leaf() [rigid when Sidebar is active]
            }
          }
        `,
        messages.unknownRegion('Sidebar'),
      )()
      await rejects(
        `
          ${leaf}
          view Orphan() { render Leaf() [rigid when Orphan is active] }
        `,
        messages.unknownRegion('Orphan'),
      )()
      await rejectsFiles(
        {
          'Main.tao': `
            ${leaf}
            ${stubContainer('Panel')}
            view Shell(Navigator nav) {
              render Panel() {
                Navigator()
                FocusBar()
              }
            }
            view FocusBar() { render Leaf() [rigid when Hidden is active] }
          `,
          'Hidden.tao': `
            ${stubView('Hidden')}
            ${stubContainer('PrivatePanel')}
            view PrivateShell(Navigator nav) {
              render PrivatePanel() {
                Navigator()
                Hidden()
              }
            }
          `,
        },
        messages.unknownRegion('Hidden'),
      )()
    },
  )

  Test(
    'rejects misspelled conditions and interaction journey heads through their ID seams',
    rejects(
      `
        ${leaf}
        app Demo { id "demo" version "1.0.0" name "Demo" view Home }
        view Home() { render Leaf() [opacity 80 when focusd] }
        test "Interaction" {
          test "spelling" {
            run Demo
            press keys "Enter"
            narow "draft"
            expect focuses region "Home"
          }
        }
      `,
      messages.condition('when focusd'),
      testValidationMessages.interactionVocabulary('key, down, or up'),
      testValidationMessages.interactionVocabulary('hover, focus, or narrow'),
      testValidationMessages.interactionExpectation,
    ),
  )

  Test(
    'rejects duplicate, contradictory, and inapplicable entity command policy',
    rejects(
      `
        ${commandFixture}
        data Notes / Note {
          Title text,
          commands { Finish, Finish, NewWorkspace },
          commands { Duplicate },
          commands hide { Finish },
          commands hide { Delete }
        }
      `,
      messages.duplicateMention("Entity 'Note' commands", 'Finish'),
      messages.duplicateEntityPolicy('Note', false),
      messages.duplicateEntityPolicy('Note', true),
      messages.conflictingEntityMention('Note', 'Finish'),
      messages.inapplicableEntityCommand('Note', 'NewWorkspace'),
    ),
  )

  Test(
    'rejects duplicate shortcuts in view, Toolbar, Commands, entity, and global static scopes',
    rejects(
      `
        ${leaf}
        action Run() { }
        data Documents / Document {
          Title text,
          commands { First, Second }
        }
        command First(Document) { Title "First" Key "x" do Run() }
        command Second(Document) { Title "Second" Key "x" do Run() }
        command GlobalOne() { Title "Global one" Key "g" do Run() }
        command GlobalTwo() { Title "Global two" Key "g" do Run() }
        scene Home(Document) {
          Title "Home"
          command ViewOne() { Title "View one" Key "v" do Run() }
          command ViewTwo() { Title "View two" Key "v" do Run() }
          Toolbar { First, Second }
          Commands { First, Second }
          render Leaf()
        }
      `,
      messages.duplicateShortcut("Entity 'Document' commands", 'x', 'First', 'Second'),
      messages.duplicateShortcut('Toolbar', 'x', 'First', 'Second'),
      messages.duplicateShortcut('Commands', 'x', 'First', 'Second'),
      messages.duplicateShortcut('Global commands', 'g', 'GlobalOne', 'GlobalTwo'),
      messages.duplicateShortcut("View 'Home' commands", 'v', 'ViewOne', 'ViewTwo'),
    ),
  )

  Test('warns when a command claims a platform editing chord', async () => {
    const result = await testValidateCode(`
      ${leaf}
      use primary from @tao/keys
      action Run() { }
      command Copy() {
        Title "Copy"
        Key primary + "c"
        do Run()
      }
    `)
    const warnings = result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')
    Expect(Diagnostics.messages(warnings)).toContain(messages.editingShortcut('Copy', 'primary+c'))
  })

  Test('warns about unnamed and dynamically named controls with a source suggestion', async () => {
    const result = await testValidateCode(`
      use Col, Text from @tao/ui
      ${leaf}
      view Missing(Press action()) { render Leaf() }
      view Dynamic(Title text, Press action()) { render Text(Title) }
      view Visible(Press action()) { render Text("Launch") }
      view Described(Description text, Press action()) { render Leaf() }
      view Main() {
        state Title = ""
        render Col() {
          Missing() { on press -> { } }
          Dynamic(Title) { on press -> { } }
          Visible() { on press -> { } }
          Described("Helpful hint") { on press -> { } }
        }
      }
    `)
    const warnings = Diagnostics.messages(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning'))
    Expect(warnings).toContain(messages.unnamedControl('Missing'))
    Expect(warnings).toContain(messages.uncertainControlName('Dynamic'))
    Expect(warnings).toContain(messages.unnamedControl('Described'))
    Expect(warnings).not.toContain(messages.unnamedControl('Visible'))
  })
})
