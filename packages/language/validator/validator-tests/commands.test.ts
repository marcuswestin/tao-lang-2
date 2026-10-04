import { Describe, stubView, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { commandValidationMessages } from '../validator-src/validators/commands-validator'
import { declarationSlotValidationMessages } from '../validator-src/validators/declaration-slots-validator'
import { ReactiveParametersValidator } from '../validator-src/validators/ReactiveParametersValidator'
import { accepts, rejects } from './test-validate'

const leaf = stubView('Leaf')

const documents = `
  data Documents / Document {
    Title text,
    Final yes / Draft no
  }
`

const songs = `
  data Songs / Song {
    Title text,
    Liked yes / Unliked no
  }
`

Describe('validator: commands as configured values', () => {
  Test(
    'accepts a module command with an entity slot, invoked with that slot as its argument',
    accepts(`
      ${leaf}
      ${documents}
      use primary from @tao/keys

      command Finish(Document) {
        Title "Finish document"
        Description "Moves a document out of drafts and into the archive."
        Summary "Finish { Document.Title }"
        Icon "checkmark.circle"
        Key primary + "f"
        Enabled Document.Final is Draft
        do -> {
          update Document { Final }
        }
      }

      view DraftRow(Document) {
        action FinishRow() {
          do Finish(Document)
        }
        render Leaf()
      }
    `),
  )

  Test(
    'accepts a renamed typed slot, read by the members and bound by type or by label when invoked',
    accepts(`
      ${leaf}
      ${songs}
      command Like(Track Song) {
        Title "Like"
        Summary "Like { Track.Title }"
        Enabled Track.Liked is Unliked
        do -> {
          update Track { Liked }
        }
      }
      view SongRow(Song) {
        action LikeRow() {
          do Like(Song)
        }
        action LikeRowByLabel() {
          do Like(Track: Song)
        }
        render Leaf()
      }
    `),
  )

  Test(
    'accepts a view-body command reading that view`s own state, with a bare name as a member value',
    accepts(`
      ${leaf}
      scene Home() {
        Title "Home"
        state Draft = ""
        state CanSave = true
        action SaveDraft() {
          set Draft = ""
        }
        command Save() {
          Title "Save workspace"
          Key "s"
          Enabled CanSave
          do SaveDraft()
        }
        Toolbar { Save }
        render Leaf()
      }
    `),
  )

  Test(
    'types a bound command over the slots the binding left open',
    accepts(`
      ${leaf}
      ${documents}
      action Run() { }
      command Finish(Document) {
        Title "Finish document"
        do Run()
      }
      view Row(Document) {
        let ToArchive = Finish with { Document }
        action Archive() {
          do ToArchive()
        }
        render Leaf()
      }
    `),
  )

  Test(
    'retains writable state when binding a mutating command slot',
    accepts(`
      ${leaf}
      action Change(Value text) { set Value += "!" }
      command Edit(Value text) {
        Title "Edit"
        do Change(Value)
      }
      view Home() {
        state Draft = "draft"
        let EditDraft = Edit with { Value: Draft }
        action Run() { do EditDraft() }
        render Leaf()
      }
    `),
  )

  Test(
    'rejects a readonly alias bound to a mutating command slot',
    rejects(
      `
        ${leaf}
        action Change(Value text) { set Value += "!" }
        command Edit(Value text) {
          Title "Edit"
          do Change(Value)
        }
        view Home() {
          let Draft = "draft"
          let EditDraft = Edit with { Value: Draft }
          render Leaf()
        }
      `,
      ReactiveParametersValidator.messages.readonlyArgument('Value'),
    ),
  )

  Test(
    'rejects a command that names no action, or names more than one',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Silent() {
          Title "Silent"
        }
        command Twice() {
          Title "Twice"
          do Run()
          do Run()
        }
      `,
      commandValidationMessages.missingDo('Silent'),
      commandValidationMessages.duplicateDo('Twice'),
    ),
  )

  Test(
    'requires a Title, because a verb nothing can name is not discoverable',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Nameless() {
          Icon "circle"
          do Run()
        }
      `,
      commandValidationMessages.missingTitle('Nameless'),
    ),
  )

  Test(
    'requires Title to be a static text literal',
    rejects(
      `
        ${leaf}
        let VerbName = "Save"
        action Run() { }
        command Save() {
          Title VerbName
          do Run()
        }
      `,
      commandValidationMessages.staticTitle('Save'),
    ),
  )

  Test(
    'rejects a command whose do names another command rather than an action',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Inner() {
          Title "Inner"
          do Run()
        }
        command Outer() {
          Title "Outer"
          do Inner()
        }
      `,
      commandValidationMessages.doTarget('Outer'),
    ),
  )

  Test(
    'holds slots to the ordinary parameter rules: declared once, and shadowing nothing in view',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Merge(Document, Document) {
          Title "Merge documents"
          do Run()
        }
        scene Detail(Document) {
          Title "Detail"
          command Finish(Document) {
            Title "Finish"
            do Run()
          }
          render Leaf()
        }
      `,
      ActionsValidator.messages.duplicateParameter('Document', 'command'),
      AliasesValidator.messages.duplicateName('Document'),
    ),
  )

  Test(
    'rejects a fill of a member the command does not have',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Bare() {
          Title "Bare"
          Mystery "x"
          do Run()
        }
      `,
      commandValidationMessages.member('Mystery', 'Title, Description, Summary, Label, Icon, Key, Enabled'),
    ),
  )

  Test(
    'gives an invocation the arity and type diagnostics an action`s do has',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Finish(Document) {
          Title "Finish document"
          do Run()
        }
        view Row(Document) {
          let ToArchive = Finish with { Document }
          action Unfilled() { do Finish() }
          action Twice() { do Finish(Document, Document) }
          action Mislabeled() { do Finish(Paper: Document) }
          action Refilled() { do ToArchive(Document) }
          render Leaf()
        }
      `,
      ActionsValidator.messages.missingArgument('Finish', 'Document'),
      ActionsValidator.messages.duplicateArgumentType('Finish'),
      ActionsValidator.messages.unknownNamedArgument('Finish', 'Paper'),
      ActionsValidator.messages.dynamicActionArguments,
    ),
  )

  Test(
    'rejects a binding naming nothing the command has, and one that overrides Title',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Finish(Document) {
          Title "Finish document"
          do Run()
        }
        command Save() {
          Title "Save"
          do Run()
        }
        view Row(Document) {
          let Misnamed = Finish with { Paper: Document }
          render Leaf()
        }
        let Renamed = Save with { Title "Store" }
      `,
      commandValidationMessages.unknownBinding('Finish', 'Paper'),
      commandValidationMessages.titleOverride('Save'),
    ),
  )

  Test(
    'rejects a shortcut that names a platform key, or a modifier no tranche has registered',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Copy() {
          Title "Copy"
          Key "cmd+c"
          do Run()
        }
        command Paste() {
          Title "Paste"
          Key "hyper+v"
          do Run()
        }
        command Bare() {
          Title "Bare"
          Key "primary+"
          do Run()
        }
      `,
      commandValidationMessages.shortcutPlatformModifier('cmd'),
      commandValidationMessages.shortcutModifier('hyper'),
      commandValidationMessages.shortcutKey,
    ),
  )

  Test(
    'rejects reducer-owned, multi-key, and duplicate-modifier shortcuts',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Escape() { Title "Escape" Key "escape" do Run() }
        command Palette() { Title "Palette" Key "primary+k" do Run() }
        command Multiple() { Title "Multiple" Key "ab" do Run() }
        command Duplicate() { Title "Duplicate" Key "primary+primary+x" do Run() }
        command Space() { Title "Space" Key " " do Run() }
      `,
      commandValidationMessages.shortcutReserved('escape'),
      commandValidationMessages.shortcutReserved('primary+k'),
      commandValidationMessages.shortcutKey,
      commandValidationMessages.shortcutDuplicateModifier('primary'),
      commandValidationMessages.shortcutReserved('space'),
    ),
  )

  Test(
    'keeps a command out of an app body',
    rejects(
      `
        ${leaf}
        action Run() { }
        app Demo {
          command Stray() {
            Title "Stray"
            do Run()
          }
          view Leaf
        }
      `,
      commandValidationMessages.placement,
    ),
  )

  Test(
    'keeps a command with an unfilled slot out of a toolbar, where nothing could fill it',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Finish(Document) {
          Title "Finish document"
          do Run()
        }
        scene Home() {
          Title "Home"
          Toolbar { Finish }
          render Leaf()
        }
      `,
      declarationSlotValidationMessages.unfilledCommand('Finish', 'Document', 'Home'),
    ),
  )

  Test(
    'accepts a mention whose slot the presenting scene supplies by type',
    accepts(`
      ${leaf}
      ${documents}
      action Run() { }
      command Finish(Document) {
        Title "Finish document"
        do Run()
      }
      scene Detail(Document) {
        Title "Detail"
        Toolbar { Finish }
        render Leaf()
      }
    `),
  )
})
