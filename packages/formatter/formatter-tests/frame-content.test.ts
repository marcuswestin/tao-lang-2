import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: frame content and render injection channels', () => {
  Test(
    'formats view slots, caller content, and explicit ambient bindings',
    formats(
      `view Card( ){
@actions=empty
render Col( ){
@actions
@@content
}
}
view Col( ){render inject Content   @@content,Layout @@layout,Tag @@tag \`\`\`ts
return null
\`\`\`}
view Main( ){
render Card( ){
@actions Button( )
}
}`,
      `
        view Card() {
           @actions = empty
           render Col() {
              @actions
              @@content
        }  }

        view Col() {
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
