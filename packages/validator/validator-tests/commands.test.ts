import { Describe, stubView, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { commandValidationMessages } from '../validator-src/validators/commands-validator'
import { declarationSlotValidationMessages } from '../validator-src/validators/declaration-slots-validator'
import { accepts, rejects } from './test-validate'

const leaf = stubView('Leaf')

const documents = `
  data Documents / Document {
    Title text
    Final yes / Draft no
  }
`

Describe('validator: commands as configured values', () => {
  Test(
    'accepts a module command with an entity slot, invoked with that slot filled',
    accepts(`
      ${leaf}
      ${documents}
      use primary from @tao/keys

      command Finish {
        Document
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
          do Finish with { Document }
        }
        render Leaf()
      }
    `),
  )

  Test(
    'accepts a view-body command reading that view`s own state, and a bare key literal',
    accepts(`
      ${leaf}
      scene Home() {
        Title "Home"
        state Draft = ""
        action SaveDraft() {
          set Draft = ""
        }
        command Save {
          Title "Save workspace"
          Key "s"
          Enabled Draft is not empty
          do SaveDraft()
        }
        Toolbar { Save }
        render Leaf()
      }
    `),
  )

  Test(
    'rejects a command that names no action, or names more than one',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Silent {
          Title "Silent"
        }
        command Twice {
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
        command Nameless {
          Icon "circle"
          do Run()
        }
      `,
      commandValidationMessages.missingTitle('Nameless'),
    ),
  )

  Test(
    'rejects two slots of one type, which would leave the verb ambiguous about what it acts on',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Merge {
          Document
          Document
          Title "Merge documents"
          do Run()
        }
      `,
      commandValidationMessages.duplicateSlotType('Document'),
    ),
  )

  Test(
    'asks for the explicit fill form when one name is both a command member and a type',
    rejects(
      `
        ${leaf}
        type Icon is text
        action Run() { }
        command Ambiguous {
          Title "Ambiguous"
          Icon
          do Run()
        }
      `,
      commandValidationMessages.ambiguousMember('Icon'),
    ),
  )

  Test(
    'rejects a member written without a value and a name that is neither member nor type',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Bare {
          Title "Bare"
          Enabled
          Mystery
          do Run()
        }
      `,
      commandValidationMessages.memberValue('Enabled'),
      commandValidationMessages.member('Mystery', 'Title, Description, Summary, Label, Icon, Key, Enabled'),
    ),
  )

  Test(
    'rejects an invocation that leaves a slot unfilled, and a binding naming nothing the command has',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Finish {
          Document
          Title "Finish document"
          do Run()
        }
        view Row(Document) {
          action Unfilled() { do Finish }
          action Misnamed() { do Finish with { Paper: Document } }
          render Leaf()
        }
      `,
      commandValidationMessages.unfilledSlot('Finish', 'Document'),
      commandValidationMessages.unknownBinding('Finish', 'Paper'),
    ),
  )

  Test(
    'rejects a binding that overrides Title, because the title is what identifies the verb',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Save {
          Title "Save"
          do Run()
        }
        let Renamed = Save with { Title "Store" }
      `,
      commandValidationMessages.titleOverride('Save'),
    ),
  )

  Test(
    'rejects a shortcut that names a platform key, or a modifier no tranche has registered',
    rejects(
      `
        ${leaf}
        action Run() { }
        command Copy {
          Title "Copy"
          Key "cmd+c"
          do Run()
        }
        command Paste {
          Title "Paste"
          Key "hyper+v"
          do Run()
        }
        command Bare {
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
    'keeps a command out of an app body and requires a call for an action `do`',
    rejects(
      `
        ${leaf}
        action Run() { }
        app Demo {
          command Stray {
            Title "Stray"
            do Run()
          }
          view Leaf
        }
        view Home() {
          action Bare() { do Run }
          render Leaf()
        }
      `,
      commandValidationMessages.placement,
      ActionsValidator.messages.doActionCall,
    ),
  )

  Test(
    'keeps a command with an unfilled slot out of a toolbar, where nothing could fill it',
    rejects(
      `
        ${leaf}
        ${documents}
        action Run() { }
        command Finish {
          Document
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
      command Finish {
        Document
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
