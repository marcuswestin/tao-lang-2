/** Use distinct, stable SQLite names even when Firebase IDs contain punctuation. */
export function accountDatabaseName(projectId: string, userId: string): string {
  const hex = (value: string) =>
    Array.from({ length: value.length }, (_, index) => value.charCodeAt(index).toString(16).padStart(4, '0')).join('')
  return `hostedcrud_${hex(projectId)}_${hex(userId)}`
}

export function firestoreNotesPath(userId: string): string {
  return `users/${userId}/notes`
}
