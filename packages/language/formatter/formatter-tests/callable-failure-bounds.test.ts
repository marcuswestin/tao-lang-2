import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: callable failure bounds', () => {
  Test(
    'formats multiple bounds on functions, associated methods and capability signatures',
    formats(
      'func Plain()fails Offline,Busy->text{return "plain"} type Token is text with{func Render()fails never->text{return "token"}static func +(Value Token)fails Rejected,Expired->Token{return Value}} can Display{Render()fails never->text,Format()fails Offline,Busy->text}',
      `
      func Plain() fails Offline, Busy -> text {
         return "plain"
      }

      type Token is text with {
         func Render() fails never -> text {
            return "token"
         }

         static func +(Value Token) fails Rejected, Expired -> Token {
            return Value
         }
      }

      can Display {
         Render() fails never -> text,
         Format() fails Offline, Busy -> text
      }
    `,
    ),
  )
})
