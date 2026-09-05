import { Describe, Expect, Test } from '@shared/test'
import {
  appIdentifier,
  type CreationPlan,
  DEFAULT_PALETTE,
  deterministicPlan,
  fallbackSampleRows,
  planFromJson,
  sampleRowsFromJson,
  sampleRowsSchema,
  suggestProjectId,
  validateCreationPlan,
} from '../cli-src/create/creation-plan'

function validPlan(): CreationPlan {
  return {
    name: 'Trip Planner',
    id: 'trip-planner',
    summary: 'Plans trips with friends.',
    entities: [{
      plural: 'Trips',
      singular: 'Trip',
      purpose: 'One trip.',
      fields: [
        { name: 'Title', type: 'text', title: true },
        { name: 'Days', type: 'number' },
        { name: 'Booked', type: 'yesno' },
        { name: 'CreatedAt', type: 'time' },
      ],
    }],
    palette: DEFAULT_PALETTE,
    samples: { Trips: [{ Title: 'Lisbon', Days: 4, Booked: true }, { Title: 'Kyoto' }] },
  }
}

Describe('tao create plan', () => {
  Test('derives names and ids from a description and validates the plain plan', () => {
    const plan = deterministicPlan('A shared grocery list for the house')
    Expect(plan.name).toBe('A Shared Grocery')
    Expect(plan.id).toBe('a-shared-grocery')
    Expect(plan.summary).toBe('A shared grocery list for the house.')
    Expect(validateCreationPlan(plan)).toEqual([])

    Expect(appIdentifier('Trip Planner!')).toBe('TripPlanner')
    Expect(appIdentifier('2 do')).toBe('App2Do')
    Expect(suggestProjectId('Trip  Planner!')).toBe('trip-planner')
    Expect(deterministicPlan('Items').entities[0]!.plural).toBe('Entries')
    Expect(deterministicPlan('', { id: 'given' })).toMatchObject({ id: 'given', name: 'App' })
  })

  Test('accepts a well-formed plan and names every way a plan can fail', () => {
    Expect(validateCreationPlan(validPlan())).toEqual([])

    const twoTitles = validPlan()
    twoTitles.entities[0]!.fields[1] = { name: 'Days', type: 'text', title: true }
    Expect(validateCreationPlan(twoTitles).join(' ')).toContain('exactly one text field as the title')

    const reserved = validPlan()
    reserved.entities[0]!.singular = 'Text'
    Expect(validateCreationPlan(reserved).join(' ')).toContain("singular 'Text' is reserved")

    const collides = validPlan()
    collides.name = 'Trips'
    Expect(validateCreationPlan(collides).join(' ')).toContain('already the app')

    const badId = validPlan()
    badId.id = 'My Trips'
    Expect(validateCreationPlan(badId).join(' ')).toContain('lowercase letters, digits, and hyphens')

    const quoted = validPlan()
    quoted.samples['Trips']![0]!['Title'] = 'Say "hi"'
    Expect(validateCreationPlan(quoted).join(' ')).toContain('quotes, backslashes, or braces')

    const unknownField = validPlan()
    unknownField.samples['Trips']![0]!['Cost'] = 3
    Expect(validateCreationPlan(unknownField).join(' ')).toContain("unknown field 'Cost'")

    const reservedField = validPlan()
    reservedField.entities[0]!.fields.push({ name: 'Id', type: 'number' })
    Expect(validateCreationPlan(reservedField).join(' ')).toContain("field 'Id' is reserved")

    const derived = validPlan()
    derived.entities.push({
      plural: 'TripLists',
      singular: 'TripList',
      purpose: 'Collides with the generated list scene.',
      fields: [{ name: 'Name', type: 'text', title: true }],
    })
    derived.samples['TripLists'] = [{ Name: 'One' }]
    Expect(validateCreationPlan(derived).join(' ')).toContain('TripList, which is already generated for Trips')

    Expect(validateCreationPlan({ ...validPlan(), samples: {} }, { samples: false })).toEqual([])
    Expect(validateCreationPlan({ ...validPlan(), samples: {} }).join(' ')).toContain("samples for 'Trips'")
  })

  Test('always produces a valid plain plan, whatever the description says', () => {
    const descriptions = [
      'Comprehensive neighborhood infrastructure reports',
      'Item list',
      'Item row',
      'Item detail',
      'Items stack',
      'Entries stack items',
      '!!! ???',
      'x'.repeat(200),
    ]
    for (const description of descriptions) {
      const plan = deterministicPlan(description)
      Expect(validateCreationPlan(plan)).toEqual([])
      Expect(plan.name.length).toBeLessThanOrEqual(40)
    }
    Expect(deterministicPlan('Item list').entities[0]!.plural).toBe('Entries')
    Expect(deterministicPlan('Comprehensive neighborhood infrastructure reports').name).toBe(
      'Comprehensive Neighborhood',
    )
    const palette = { canvas: '#fdf6e3', ink: '#073642', accent: '#d33682' }
    Expect(deterministicPlan('Notes', { palette }).palette).toEqual(palette)

    const braces = validPlan()
    braces.name = 'My {Notes}'
    Expect(validateCreationPlan(braces).join(' ')).toContain('name may not contain quotes, backslashes, or braces')
  })

  Test('reads model JSON leniently and builds sample schemas from the fields', () => {
    const plan = planFromJson({
      name: ' Trip Planner ',
      id: 'trip-planner',
      summary: 'Plans trips.',
      entities: [{
        plural: 'Trips',
        singular: 'Trip',
        purpose: 'One trip.',
        fields: [{ name: 'Title', type: 'text', title: true }],
      }],
      palette: { canvas: '#ffffff', ink: '#111111', accent: '#ff6600' },
    }, {})
    Expect(plan.name).toBe('Trip Planner')
    Expect(plan.entities[0]!.fields).toEqual([{ name: 'Title', type: 'text', title: true }])

    const entity = validPlan().entities[0]!
    const schema = sampleRowsSchema(entity)
    Expect(Object.keys(schema.properties!['rows']!.items!.properties!)).toEqual(['Title', 'Days', 'Booked'])
    Expect(schema.properties!['rows']!.items!.required).toEqual(['Title'])

    Expect(sampleRowsFromJson(entity, {
      rows: [{ Title: 'Lisbon', Days: 4, Booked: false, Bogus: 'x', CreatedAt: 'now' }, 'junk', {
        Title: 'Kyoto',
        Booked: true,
      }],
    })).toEqual([{ Title: 'Lisbon', Days: 4 }, { Title: 'Kyoto', Booked: true }])

    Expect(fallbackSampleRows(entity)).toEqual([{ Title: 'Trip one' }, { Title: 'Trip two' }, { Title: 'Trip three' }])
  })
})
