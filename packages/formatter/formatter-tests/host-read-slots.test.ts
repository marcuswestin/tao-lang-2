import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: host-read slots and commands', () => {
  Test(
    'formats aliases, fills, commands, and toolbar journey steps',
    formats(
      `
        use package @tao/nav/native as native
        public type StackNav=native.StackNav
        action Save(){Title "Save"}
        view Home(){
        Title   "Home"
        command SaveCommand=Save()with{Label when true "Save"/not "Wait" Enabled    true}
        Toolbar{SaveCommand  SaveCommand}
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

        action Save() {
           Title "Save"
        }

        view Home() {
           Title "Home"
           command SaveCommand = Save() with {
              Label when true "Save" / not "Wait"
              Enabled true
           }
           Toolbar { SaveCommand SaveCommand }
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
})
