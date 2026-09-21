/**
 * The exports this package publishes to programs that its own tests build as source text and run in
 * a separate `bun` process. An import written inside a string is not an import any TypeScript tool
 * can follow, so `dead-exports` sees these symbols as unimported and would fail the lane on them.
 *
 * `config/knip.json` declares this file an entry point, which is knip's own documented answer to an
 * export whose consumer it cannot see. The alternative it offers is a per-symbol `@public` JSDoc
 * tag, which this repository does not use: a tag scatters the record across the tree and records
 * only that a symbol is spared, never who reaches it.
 *
 * A file like this one is named for the one reason its exports are here, and a package that needs
 * to spare an export for a different reason gets its own named file and its own entry line in
 * `config/knip.json` rather than a second line in this one. That is what keeps a carve-out from
 * decaying into a list of exports nobody can account for. The record belongs to the package that
 * declares the symbol: the `crossPackageSourceImportIssues` repo lint forbids reaching into another
 * package's source, and each package's `tsconfig.json` compiles only its own directories.
 *
 * Every entry below is a claim that a child process really imports the symbol by this path. Delete
 * the entry when that stops being true and let the gate report the symbol, rather than leaving a
 * record that vouches for dead code.
 */

/**
 * `ship-transaction.test.ts` widens the stale-unlink replacement race deterministically, and has to
 * do it from a second process to race against this one. It imports this seam by absolute path from
 * inside the program string it hands to `bun -e`.
 */
export { ShipTransactionTesting } from './ship-transaction'
