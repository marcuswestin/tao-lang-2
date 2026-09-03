import Formatter from '@formatter'
const src = `app A { Name "A" Navigator N { Initial V } }

view V() {
   render Text("hi")
}

scenarios V "states" {
   device phone
   appearance light
   network online
   locale "en"
   scenario "empty" {
      render (: emptyRow)
}  }
`
try { console.log('FORMATTED OK:\n' + await Formatter.formatCode(src)) } catch (e) { console.log('REFUSED: ' + String(e instanceof Error ? e.message : e)) }
