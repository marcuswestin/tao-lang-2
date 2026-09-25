import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: minimal design', () => {
  Test(
    'formats flat tokens and named combined bundles deterministically',
    formats(
      'workspace   design   Theme{paper   #fff alpha #abcd overlayColor #121826cc screen[fill,content top stretch,pad 16,bg paper] title[size 28,weight 700,fg paper]}',
      `
        workspace
        design Theme {
           paper #fff
           alpha #abcd
           overlayColor #121826cc
           screen [fill, content top stretch, pad 16, bg paper]
           title [size 28, weight 700, fg paper]
        }
      `,
    ),
  )

  Test(
    'formats a declaration header clause and a clearing term like a render clause',
    formats(
      `workspace
design Theme{paper #fff}
view   Card()[pad 12,bg paper]{
render Surface()[bg none,pad left none]
}
scene Page()   responds Answer[gap 8]{
render Surface()
}
view Surface(){}`,
      `
        workspace
        design Theme {
           paper #fff
        }

        view Card() [pad 12, bg paper] {
           render Surface() [bg none, pad left none]
        }

        scene Page() responds Answer [gap 8] {
           render Surface()
        }

        view Surface() { }
      `,
    ),
  )

  Test(
    'formats a color parameter, its design color default and shade argument, and a clause value read',
    formats(
      `view   Badge(Label text,Tint   color default   inkMuted){
render Surface()[statusDot,background   Tint]
}
view Main(){render Badge("Final",Tint:accent.20)}`,
      `
        view Badge(Label text, Tint color default inkMuted) {
           render Surface() [statusDot, background Tint]
        }

        view Main() {
           render Badge("Final", Tint: accent.20)
        }
      `,
    ),
  )
})
