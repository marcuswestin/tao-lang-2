/** AccountProtocol is the versioned localhost reference auth/data wire contract. */
export namespace AccountProtocol {
  export const prefix = '/v1'
  export type Credentials = { email: string; password: string; resource: string }
  export type Session = {
    accountId: string
    expiresAt: number
    issuer: string
    resource: string
    subject: string
    token: string
  }
  export type Row = { entity: string; fields: Record<string, unknown>; id: string }
  export type Snapshot = { revision: number; rows: Row[] }
  /** DataKey is issued only after verified authentication and never stored with ciphertext. */
  export type DataKey = { accountId: string; key: string; resource: string }
  export type Operation =
    | { entity: string; fields: Record<string, unknown>; id: string; kind: 'create' }
    | { entity: string; fields: Record<string, unknown>; id: string; kind: 'update' }
    | { entity: string; id: string; kind: 'delete' }
  export type Transaction = { operationId: string; operations: Operation[] }
  export type Receipt = { operationId: string; revision: number; status: 'saved' }
  export type Failure = {
    error: { code: 'invalid' | 'unauthorized' | 'forbidden' | 'conflict' | 'unavailable'; message: string }
  }
}
