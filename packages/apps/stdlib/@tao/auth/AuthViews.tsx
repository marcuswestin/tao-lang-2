import TR from '@runtime/TR'
import React from 'react'
import { Button, Modal, Text, TextInput, View } from 'react-native'
import { type AuthFlow, type LoginFlowValue, SignInFlow } from './AuthFlow'

type AuthProps = { Auth?: TR.AuthScope; Account?: TR.Evaluable; Layout?: TR.TaoVisualLayout; Tag?: string }

/** Supplied and presented UI share the headless flow, including failure and cancellation state. */
export function SignInView(props: AuthProps & { Flow?: LoginFlowValue | null }): React.ReactElement {
  const context = TR.Auth.UseOptionalContext()
  const scope = props.Auth ?? context
  if (!scope) {
    return <Text>Authentication requires an app with an Auth provider.</Text>
  }
  const flow = props.Flow
  if (flow && !isAuthFlow(flow)) {
    return <Text>The supplied flow must be created by SignInFlow().</Text>
  }
  return <SignInForm scope={scope} flow={flow ?? undefined} />
}

function isAuthFlow(flow: LoginFlowValue): flow is AuthFlow {
  return 'writeMember' in flow && typeof flow.writeMember === 'function'
    && 'subscribe' in flow && typeof flow.subscribe === 'function'
}

function SignInForm({ scope, flow: supplied }: { scope: TR.AuthScope; flow?: AuthFlow }): React.ReactElement {
  const [flow] = React.useState(() => supplied ?? SignInFlow(scope, scope.capabilities.methods[0] ?? 'Password'))
  const [, changed] = React.useReducer(value => value + 1, 0)
  React.useEffect(() => flow.subscribe(changed), [flow])
  const code = flow.Step === 'Code'
  return (
    <View accessibilityLabel="Sign in">
      <Text>{code ? 'Enter your code' : 'Sign in'}</Text>
      {!code && (
        <TextInput
          accessibilityLabel="Email"
          value={flow.Email}
          autoCapitalize="none"
          keyboardType="email-address"
          onChangeText={value => flow.writeMember(['Email'], value)}
        />
      )}
      {flow.Step === 'Password' && (
        <TextInput
          accessibilityLabel="Password"
          value={flow.Password}
          secureTextEntry
          onChangeText={value => flow.writeMember(['Password'], value)}
        />
      )}
      {code && (
        <TextInput
          accessibilityLabel="Code"
          value={flow.Code}
          secureTextEntry
          onChangeText={value => flow.writeMember(['Code'], value)}
        />
      )}
      {flow.Problem !== '' && <Text accessibilityRole="alert">{flow.Problem}</Text>}
      {flow.Step === 'Cancelled'
        ? (
          <Button
            title="Try again"
            onPress={() => {
              void flow.Reset.invoke()
            }}
          />
        )
        : (
          <Button
            title={code ? 'Verify' : flow.Step === 'Email' ? 'Send code' : 'Sign in'}
            disabled={flow.Running}
            onPress={() => {
              void flow.Submit.invoke()
            }}
          />
        )}
      {code && (
        <Button
          title="Resend code"
          disabled={flow.Running || flow.RetryAfter > 0}
          onPress={() => {
            void flow.Resend.invoke()
          }}
        />
      )}
      <Button
        title="Cancel"
        onPress={() => {
          void flow.Cancel.invoke()
        }}
      />
    </View>
  )
}

export function AuthPresentation({ scope }: { scope: TR.AuthScope }): React.ReactElement {
  return (
    <Modal
      visible={scope.presenting}
      onRequestClose={() => {
        scope.cancel()
      }}
    >
      <SignInForm scope={scope} />
    </Modal>
  )
}

/** Profile edits remain local until the server-backed data action accepts them. */
export function AccountView({ Account, Auth }: AuthProps): React.ReactElement {
  const [displayName, setDisplayName] = React.useState('')
  const [problem, setProblem] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const account = Account?.evaluate().jsValue
  const name = account ? TR.Member(Account!, ['DisplayName']).evaluate().jsValue : undefined
  React.useEffect(() => {
    setDisplayName(typeof name === 'string' ? name : '')
  }, [name])
  async function save(): Promise<void> {
    if (!Account || !Auth || running) {
      return
    }
    setRunning(true)
    setProblem('')
    try {
      const outcome = await TR.Auth.SaveProfile(Auth, Account, { DisplayName: TR.Value(displayName) })
      if (outcome.status !== 'completed') {
        setProblem(outcome.message ?? 'Unable to save your profile. Your changes are still here.')
      }
    } catch {
      setProblem('Unable to save your profile. Your changes are still here.')
    } finally {
      setRunning(false)
    }
  }
  if (!account) {
    return <Text>Loading account…</Text>
  }
  return (
    <View accessibilityLabel="Account profile">
      <TextInput accessibilityLabel="Display name" value={displayName} onChangeText={setDisplayName} />
      {problem !== '' && <Text accessibilityRole="alert">{problem}</Text>}
      <Button
        title="Save profile"
        disabled={running}
        onPress={() => {
          void save()
        }}
      />
    </View>
  )
}
