/** Calendar time for persisted receipts and native observations, independent of the app's controlled clock.
 * This named effect adapter is explicitly approved by the host-testing lint lane.
 */
export function hostArtifactDate(): Date {
  return new Date()
}
