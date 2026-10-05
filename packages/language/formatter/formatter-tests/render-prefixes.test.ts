import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: render prefixes', () => {
  for (
    const prefix of [
      '#save accessible label "Save"',
      '#save\naccessible label "Save"',
      'accessible label "Save" #save',
      'accessible label "Save"\n#save',
      '#save a11y label "Save"',
      'a11y label "Save"\n#save',
    ]
  ) {
    Test(
      `canonicalizes the prefix pair ${JSON.stringify(prefix)}`,
      formats(
        `view Home(){render Col(){${prefix}\nButton()}}`,
        `
        view Home() {
           render Col() {
              #save accessible label "Save"
              Button()
        }  }
        `,
      ),
    )
  }

  Test(
    'keeps a dynamic shorthand label separate from a bare custom view',
    formats(
      'view Home(){let Caption="Save"\nrender Col(){a11y label Caption\nCustom}}',
      `
      view Home() {
         let Caption = "Save"
         render Col() {
            accessible label Caption
            Custom
      }  }
      `,
    ),
  )

  Test(
    'preserves label grouping before a quoted child when reordering metadata',
    formats(
      'view Home(){let Caption="Save"\nrender Col(){a11y label (Caption)\n#save\n"Child"}}',
      `
      view Home() {
         let Caption = "Save"
         render Col() {
            #save accessible label (Caption)
            "Child"
      }  }
      `,
    ),
  )

  Test(
    'keeps the separating tag when reordering would consume a quoted target as a constructor value',
    formats(
      'view Home(){let Caption="Save"\nrender Col(){a11y label Caption #save "Child"}}',
      `
      view Home() {
         let Caption = "Save"
         render Col() {
            accessible label Caption #save
            "Child"
      }  }
      `,
    ),
  )

  Test(
    'canonicalizes safe clusters independently of a label whose tag separates a quotation',
    formats(
      'view Home(){let Caption="Save"\nrender Col(){a11y label Caption #first "Child"\naccessible label "Safe" #second Button()}}',
      `
      view Home() {
         let Caption = "Save"
         render Col() {
            accessible label Caption #first
            "Child"

            #second accessible label "Safe"
            Button()
      }  }
      `,
    ),
  )

  Test(
    'keeps a literal label distinct from the following quotation',
    formats(
      'view Home(){render Col(){a11y label "Caption" "Child"}}',
      `
      view Home() {
         render Col() {
            accessible label "Caption"
            "Child"
      }  }
      `,
    ),
  )

  Test(
    'preserves a comment between reversed metadata rather than moving it',
    formats(
      `view Home(){render Col(){a11y label "Save"
      // Names the next tag.
      #save
      Button()}}`,
      `
      view Home() {
         render Col() {
            accessible label "Save"
            // Names the next tag.
            #save
            Button()
      }  }
      `,
    ),
  )

  Test(
    'preserves a grouped alias label before a quotation without a tag',
    formats(
      'view Home(){let Caption="Save"\nrender Col(){accessible label (Caption) "Child"}}',
      `
      view Home() {
         let Caption = "Save"
         render Col() {
            accessible label (Caption)
            "Child"
      }  }
      `,
    ),
  )

  Test(
    'keeps a trailing tag comment attached while preserving reversed metadata',
    formats(
      `view Home(){render Col(){accessible label "Save"
      #save // The tag stays here.
      Button()}}`,
      `
      view Home() {
         render Col() {
            accessible label "Save"

            #save // The tag stays here.
            Button()
      }  }
      `,
    ),
  )

  Test(
    'preserves an inline comment inside a label expression',
    formats(
      'view Home(){render Col(){#save\na11y label (/* Caption */ "Save")\nButton()}}',
      `
      view Home() {
         render Col() {
            #save

            accessible label (/* Caption */ "Save")
            Button()
      }  }
      `,
    ),
  )

  Test(
    'keeps metadata attached to one occurrence with separation from the surrounding run',
    formats(
      'view Home(){render Col(){Text("Before")\naccessible label "Save"\n#save\nButton()\nText("After")\n#last\nText("Last")}}',
      `
      view Home() {
         render Col() {
            Text("Before")

            #save accessible label "Save"
            Button()
            Text("After")

            #last
            Text("Last")
      }  }
      `,
    ),
  )

  Test(
    'retains legacy tag-only loop and named fill formatting',
    formats(
      'view Home(){render Col(){#rows\nloop Items/Item{#row\nText(Item.Title)}\n#panel\nPanel{@header Text("Heading")}}}',
      `
      view Home() {
         render Col() {
            #rows
            loop Items / Item {
               #row
               Text(Item.Title)
            }

            #panel
            Panel {
               @header Text("Heading")
      }  }  }
      `,
    ),
  )
})
