import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: frame content and render injection channels', () => {
  Test(
    'formats frame slots, caller content, and explicit ambient bindings',
    formats(
      `frame Card( ){
@actions=empty
render Col( ){
@actions
@@content
}
}
layout Col( ){render inject Content   @@content,Layout @@layout,Tag @@tag \`\`\`ts
return null
\`\`\`}
view Main( ){
render Card( ){
@actions Button( )
}
}`,
      `
        frame Card() {
           @actions = empty
           render Col() {
              @actions
              @@content
        }  }

        layout Col() {
           render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
              return null
           \`\`\`
        }

        view Main() {
           render Card() {
              @actions Button()
        }  }
      `,
    ),
  )
})
