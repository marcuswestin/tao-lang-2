import TR from '@runtime/TR'

/** The TypeScript side of `@tao/linking`; Tao owns the complete public contract. */
export async function OpenUrl(url: string): Promise<void> {
  await TR.openUrl(url)
}
