import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: host-read slots and commands', () => {
  Test(
    'formats aliases, fills, commands, and toolbar journey steps',
    formats(
      `
        use package @tao/nav/native as native
        public type StackNav=native.StackNav
        action Save(){}
        scene Home(){
        Title   "Home"
        command SaveCommand (){Label when true "Save"/not "Wait" Enabled    true do Save()}
        Toolbar{SaveCommand,SaveCommand}
        render Text()
        }
        test "chrome"{
        run Demo
        expect navigation title "Home"
        expect toolbar    command "Save" enabled
        press toolbar    command "Save"
        }
      `,
      `
        use package @tao/nav/native as native

        public
        type StackNav = native.StackNav

        action Save() { }

        scene Home() {
           Title "Home"
           command SaveCommand() {
              Label when true "Save" / not "Wait"
              Enabled true
              do Save()
           }
           Toolbar { SaveCommand, SaveCommand }
           render Text()
        }

        test "chrome" {
           run Demo
           expect navigation title "Home"
           expect toolbar command "Save" enabled
           press toolbar command "Save"
        }
      `,
    ),
  )

  Test(
    'formats a command head as a view`s, and its members and invocation one to a line',
    formats(
      `
        data Documents / Document { Title text Final yes / Draft no }
        package command Finish( Document ){Title "Finish document" Enabled Document.Final is Draft do -> { update Document { Final } }}
        command Archive(Paper   Document,Count number default 1){Title "Archive" do -> { update Paper { Final } }}
      `,
      `
        data Documents / Document {
           Title text
           Final yes / Draft no
        }

        package
        command Finish(Document) {
           Title "Finish document"
           Enabled Document.Final is Draft
           do -> { update Document {
              Final
           } }
        }

        command Archive(Paper Document, Count number default 1) {
           Title "Archive"
           do -> { update Paper {
              Final
           } }
        }
      `,
    ),
  )
})
