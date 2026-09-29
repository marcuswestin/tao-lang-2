import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { createAppwriteAdapter } from './appwrite'
import { config } from './config'
import type { CrudAdapter, CrudConnection, CrudNote, CrudStatus, CrudUser } from './contract'
import { createFirebaseAdapter } from './firebase'

type Provider = 'Firebase + RxDB' | 'Appwrite + Legend'

const providerNames: readonly Provider[] = ['Firebase + RxDB', 'Appwrite + Legend']

function configured(provider: Provider): boolean {
  const values = provider === 'Firebase + RxDB' ? config.firebase : config.appwrite
  return Object.values(values).every(value => !value.includes('REPLACE_WITH'))
}

function Button({ title, onPress, disabled = false }: { title: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  )
}

export default function App() {
  const [provider, setProvider] = useState<Provider>('Firebase + RxDB')
  const [user, setUser] = useState<CrudUser>()
  const [notes, setNotes] = useState<readonly CrudNote[]>([])
  const [status, setStatus] = useState<CrudStatus>('local')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newText, setNewText] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const connection = useRef<CrudConnection | undefined>(undefined)
  const generation = useRef(0)
  const adapter = useMemo<CrudAdapter>(() =>
    provider === 'Firebase + RxDB'
      ? createFirebaseAdapter(config.firebase)
      : createAppwriteAdapter(config.appwrite), [provider])

  useEffect(() => {
    const current = ++generation.current
    connection.current = undefined
    setNotes([])
    setUser(undefined)
    setError('')
    if (!configured(provider)) {
      setRestoring(false)
      return
    }
    setRestoring(true)
    void adapter.restore().then(async restored => {
      if (current !== generation.current) {
        return
      }
      if (restored) {
        await open(restored, adapter, current)
      }
    }).catch(problem => {
      if (current === generation.current) {
        setError(message(problem))
      }
    }).finally(() => {
      if (current === generation.current) {
        setRestoring(false)
      }
    })
    return () => {
      generation.current++
      const old = connection.current
      connection.current = undefined
      if (old) {
        void old.close()
      }
    }
  }, [adapter, provider])

  async function open(nextUser: CrudUser, source: CrudAdapter, current = generation.current): Promise<void> {
    const opened = await source.open(nextUser, (rows, nextStatus) => {
      if (current !== generation.current) {
        return
      }
      setNotes(rows)
      setStatus(nextStatus)
    })
    try {
      const rows = await opened.list()
      if (current !== generation.current) {
        await opened.close()
        return
      }
      connection.current = opened
      setNotes(rows)
      setUser(nextUser)
    } catch (problem) {
      await opened.close()
      throw problem
    }
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (problem) {
      setError(message(problem))
    } finally {
      setBusy(false)
    }
  }

  function auth(mode: 'register' | 'signIn'): void {
    void run(async () => {
      const nextUser = mode === 'register'
        ? await adapter.register(email.trim(), password)
        : await adapter.signIn(email.trim(), password)
      await open(nextUser, adapter)
      setPassword('')
    })
  }

  function signOut(): void {
    void run(async () => {
      const old = connection.current
      connection.current = undefined
      await old?.close()
      await adapter.signOut()
      setUser(undefined)
      setNotes([])
      setDrafts({})
      setStatus('local')
    })
  }

  async function refreshAfterWrite(): Promise<void> {
    if (connection.current) {
      setNotes(await connection.current.list())
    }
  }

  function add(): void {
    const value = newText.trim()
    if (!value) {
      return
    }
    void run(async () => {
      await connection.current?.create(value)
      setNewText('')
      await refreshAfterWrite()
    })
  }

  function update(note: CrudNote, patch: Partial<Pick<CrudNote, 'text' | 'done'>>): void {
    void run(async () => {
      await connection.current?.update(note.id, {
        text: patch.text ?? note.text,
        done: patch.done ?? note.done,
      })
      await refreshAfterWrite()
    })
  }

  function remove(id: string): void {
    void run(async () => {
      await connection.current?.remove(id)
      await refreshAfterWrite()
    })
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Hosted CRUD spike</Text>
      <Text style={styles.caption}>One notes flow, two hosted stacks</Text>
      <View style={styles.providerRow}>
        {providerNames.map(name => (
          <Pressable
            key={name}
            accessibilityRole="button"
            // Each provider keeps its own session, so switching needs no sign-out; the effect closes the old connection.
            disabled={busy || restoring}
            onPress={() => setProvider(name)}
            style={[styles.provider, provider === name && styles.selected, (busy || restoring) && styles.disabled]}
          >
            <Text style={styles.providerText}>{name}</Text>
          </Pressable>
        ))}
      </View>
      {!configured(provider) && (
        <Text style={styles.notice}>
          Run ./tao connect for this provider from the repository root to enter its public project settings.
        </Text>
      )}
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {restoring && <ActivityIndicator accessibilityLabel="Restoring session" />}
      {!restoring && !user && configured(provider) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sign in or create an account</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            secureTextEntry
            placeholder="Password"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          <View style={styles.actions}>
            <Button title="Sign in" disabled={busy} onPress={() => auth('signIn')} />
            <Button title="Create account" disabled={busy} onPress={() => auth('register')} />
          </View>
        </View>
      )}
      {user && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{user.email}</Text>
          <Text style={styles.caption}>Sync: {status}</Text>
          <Button title="Sign out" disabled={busy} onPress={signOut} />
          <TextInput
            accessibilityLabel="New note"
            placeholder="New note"
            style={styles.input}
            value={newText}
            onChangeText={setNewText}
            onSubmitEditing={add}
          />
          <Button title="Add note" disabled={busy || !newText.trim()} onPress={add} />
          {notes.length === 0 && <Text style={styles.caption}>No notes yet</Text>}
          {notes.map(note => (
            <View key={note.id} style={styles.note}>
              <View style={styles.noteTop}>
                <Switch
                  accessibilityLabel={`Completed: ${note.text}`}
                  value={note.done}
                  onValueChange={done => update(note, { done })}
                  disabled={busy}
                />
                <TextInput
                  accessibilityLabel={`Edit: ${note.text}`}
                  style={[styles.input, styles.noteInput]}
                  value={drafts[note.id] ?? note.text}
                  onChangeText={text => setDrafts(current => ({ ...current, [note.id]: text }))}
                />
              </View>
              <View style={styles.actions}>
                <Button
                  title="Save"
                  disabled={busy}
                  onPress={() => update(note, { text: drafts[note.id] ?? note.text })}
                />
                <Button title="Delete" disabled={busy} onPress={() => remove(note.id)} />
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

function message(problem: unknown): string {
  return problem instanceof Error ? problem.message : 'The request failed. Try again.'
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 12, backgroundColor: '#f7f8fb', minHeight: '100%' },
  heading: { fontSize: 28, fontWeight: '700', color: '#18263b' },
  caption: { fontSize: 14, color: '#586579' },
  providerRow: { flexDirection: 'row', gap: 8 },
  provider: { flex: 1, borderWidth: 1, borderColor: '#a6b0bf', borderRadius: 10, padding: 10 },
  selected: { backgroundColor: '#dceaff', borderColor: '#3269b2' },
  providerText: { fontWeight: '600', color: '#18263b' },
  notice: { color: '#774d13', backgroundColor: '#fff2d7', padding: 12, borderRadius: 8 },
  error: { color: '#8d1e2d', backgroundColor: '#ffe4e7', padding: 12, borderRadius: 8 },
  section: { gap: 10, marginTop: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#18263b' },
  input: { borderWidth: 1, borderColor: '#a6b0bf', borderRadius: 8, padding: 12, backgroundColor: '#fff' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { backgroundColor: '#205fa9', borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14 },
  buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  note: { backgroundColor: '#fff', padding: 12, borderRadius: 10, gap: 8 },
  noteTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteInput: { flex: 1 },
})
