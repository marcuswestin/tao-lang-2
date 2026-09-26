import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: interaction attention', () => {
  Test(
    'formats command policy, interaction conditions, and reducer journey steps',
    formats(
      `data Documents/Document{Title text,
commands { Finish,Duplicate },
commands hide { Delete }}
view Row(Document){Commands{Finish}
hide Duplicate,Delete
render Leaf()[opacity 80 when focused,background panel when Sidebar is active]}
test "Attention"{test "drives"{run Demo
press key "Enter"
narrow "dra"
expect target "Draft"
expect focus region "Documents"
expect verbs "Finish","Duplicate"}}`,
      `
        data Documents / Document {
           Title text,

           commands { Finish, Duplicate },
           commands hide { Delete }
        }

        view Row(Document) {
           Commands { Finish }
           hide Duplicate, Delete
           render Leaf() [opacity 80 when focused, background panel when Sidebar is active]
        }

        test "Attention" {
           test "drives" {
              run Demo
              press key "Enter"
              narrow "dra"
              expect target "Draft"
              expect focus region "Documents"
              expect verbs "Finish", "Duplicate"
           }
        }
      `,
    ),
  )
})
