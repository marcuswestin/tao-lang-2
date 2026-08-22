/**
 * Unit values (Decisions §2). A unit family has a canonical base and fixed ratios, so `.unit` on a
 * number constructs a value of that family and `.unit` on a value of it reads the value back as a
 * number in that unit. Registering a family adds a row here; no language construct changes.
 *
 * `duration` is the only family the focused writing tranche registers, because it is the only one a
 * real feature forces (Process principle 2). Its base is the nanosecond, per §2.
 */

/** UnitFamily names one convertible family of unit values. */
export type UnitFamily = 'duration'

/** UnitReading names a non-numeric reading a family exposes as a member. */
export type UnitReading = 'Clock'

const NANOSECONDS_PER_MILLISECOND = 1e6

/**
 * Ratios convert one unit to the family base. `min`, not `m`, spells minutes: `m` is meters, and
 * months and years are calendar arithmetic rather than durations, so neither is a unit here.
 */
const durationRatios = ratiosWithAliases({
  ms: NANOSECONDS_PER_MILLISECOND,
  s: 1e3 * NANOSECONDS_PER_MILLISECOND,
  min: 60 * 1e3 * NANOSECONDS_PER_MILLISECOND,
  h: 60 * 60 * 1e3 * NANOSECONDS_PER_MILLISECOND,
  d: 24 * 60 * 60 * 1e3 * NANOSECONDS_PER_MILLISECOND,
  wk: 7 * 24 * 60 * 60 * 1e3 * NANOSECONDS_PER_MILLISECOND,
}, {
  ms: ['millisecond'],
  s: ['second'],
  min: ['minute'],
  h: ['hour'],
  d: ['day'],
  wk: ['week'],
})

const families: Record<UnitFamily, Readonly<Record<string, number>>> = { duration: durationRatios }

const readings: Record<UnitFamily, readonly UnitReading[]> = { duration: ['Clock'] }

/** Units resolves unit names, conversion ratios, and family readings. */
export const Units = {
  /** isFamily reports whether a name is a registered unit family, which is also a primitive type. */
  isFamily(name: string): name is UnitFamily {
    return unitFamilies().includes(name as UnitFamily)
  },

  /** familyOf returns the family a unit name belongs to, if any. */
  familyOf(unit: string): UnitFamily | undefined {
    return unitFamilies().find(family => unit in families[family])
  },

  /** ratioToBase returns how many base units one of the named unit is worth. */
  ratioToBase(family: UnitFamily, unit: string): number | undefined {
    return families[family][unit]
  },

  /** unitsOf lists every unit name a family accepts, canonical spellings first. */
  unitsOf(family: UnitFamily): readonly string[] {
    return Object.keys(families[family])
  },

  /** readingOf returns the named non-numeric reading a family exposes, if it has one. */
  readingOf(family: UnitFamily, member: string): UnitReading | undefined {
    return readings[family].find(reading => reading === member)
  },

  /** membersOf lists every member a value of the family answers to. */
  membersOf(family: UnitFamily): readonly string[] {
    return [...Units.unitsOf(family), ...readings[family]]
  },

  /** baseToMilliseconds converts a duration in its base unit to whole and fractional milliseconds. */
  baseToMilliseconds(nanoseconds: number): number {
    return nanoseconds / NANOSECONDS_PER_MILLISECOND
  },

  /** millisecondsToBase converts milliseconds to the duration family's base unit. */
  millisecondsToBase(milliseconds: number): number {
    return milliseconds * NANOSECONDS_PER_MILLISECOND
  },
} as const

function unitFamilies(): readonly UnitFamily[] {
  return Object.keys(families) as UnitFamily[]
}

/**
 * Long singular and plural aliases read naturally at a call site (`1.second`, `30.seconds`) and
 * convert identically, so they are ordinary rows rather than a second lookup path.
 */
function ratiosWithAliases(
  canonical: Readonly<Record<string, number>>,
  aliases: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, number>> {
  const ratios: Record<string, number> = { ...canonical }
  for (const [unit, names] of Object.entries(aliases)) {
    for (const name of names) {
      ratios[name] = canonical[unit]!
      ratios[`${name}s`] = canonical[unit]!
    }
  }
  return ratios
}
