import { Assert } from '@shared/core'
import React, { useEffect, useState } from 'react'
import { bindClerkDriverHost, classifyClerkSignInError, releaseClerkHostWhenIdle } from './ClerkDriver'

type HostProps = { configuration: Readonly<Record<string, unknown>>; children?: React.ReactNode }
let nativeOwner: object | undefined

function Binding({ configuration, children }: HostProps) {
  const { useClerk, isClerkAPIResponseError } = require('@clerk/expo') as typeof import('@clerk/expo')
  const clerk = useClerk()
  useEffect(() => {
    if (clerk.loaded) {
      return bindClerkDriverHost(
        configuration,
        clerk,
        error => isClerkAPIResponseError(error) ? classifyClerkSignInError(error) : undefined,
      )
    }
    return undefined
  }, [clerk, clerk.loaded, configuration, isClerkAPIResponseError])
  return <>{children}</>
}

/** SDK imports happen at the mounted host boundary so compiler and server consumers stay platform neutral. */
export function ClerkHost({ configuration, children }: HostProps) {
  const { Platform } = require('react-native') as typeof import('react-native')
  const native = Platform.OS !== 'web'
  const [admitted, setAdmitted] = useState(!native)
  useEffect(() => {
    if (!native) {
      return undefined
    }
    Assert.input(!nativeOwner, 'Only one Clerk app can be mounted at a time on this device.')
    const owner = {}
    nativeOwner = owner
    setAdmitted(true)
    return () => {
      releaseClerkHostWhenIdle(configuration, () => {
        if (nativeOwner === owner) {
          nativeOwner = undefined
        }
      })
    }
  }, [native, configuration])
  if (!admitted) {
    return null
  }
  const publishableKey = configuration['PublishableKey']
  Assert.input(typeof publishableKey === 'string' && publishableKey.length > 0, 'Clerk requires a PublishableKey.')
  const { ClerkProvider } = require('@clerk/expo') as typeof import('@clerk/expo')
  const { tokenCache } = require('@clerk/expo/token-cache') as typeof import('@clerk/expo/token-cache')
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <Binding configuration={configuration}>
        {children}
        {!native && <div id="clerk-captcha" />}
      </Binding>
    </ClerkProvider>
  )
}
