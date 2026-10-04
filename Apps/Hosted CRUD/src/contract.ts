export type CrudUser = Readonly<{ id: string; email: string }>

export type CrudNote = Readonly<{
  id: string
  text: string
  done: boolean
  updatedAt: number
}>

export type CrudStatus = 'local' | 'syncing' | 'synced' | 'error'

export type CrudConnection = {
  list(): Promise<readonly CrudNote[]>
  create(text: string): Promise<void>
  update(id: string, values: Pick<CrudNote, 'text' | 'done'>): Promise<void>
  remove(id: string): Promise<void>
  close(): Promise<void>
}

export type CrudAdapter = {
  restore(): Promise<CrudUser | undefined>
  register(email: string, password: string): Promise<CrudUser>
  signIn(email: string, password: string): Promise<CrudUser>
  signOut(): Promise<void>
  open(user: CrudUser, onChange: (notes: readonly CrudNote[], status: CrudStatus) => void): Promise<CrudConnection>
}
