declare module 'better-opn' {
  /** betterOpen opens a URL using better-opn's browser reuse behavior. */
  export default function betterOpen(url: string): Promise<unknown>
}
