import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: inline renderer inputs', () => {
  Test(
    'canonicalizes both input lists to bare names and retains forwarding',
    formats(
      `view Main { render Host { @item(Entry,Position)->Entry[pad 8] @footer: @outer } }`,
      `
    view Main {
       render Host {
          @item Entry, Position -> Entry [pad 8]
          @footer: @outer
    }  }`,
    ),
  )

  Test(
    'retains comments beside parenthesized inputs',
    formats(
      `view Main { render Host { @item(/* row */Entry, Position)->Entry } }`,
      `
    view Main {
       render Host {
          @item(/* row */Entry, Position) -> Entry
    }  }`,
    ),
  )
})
