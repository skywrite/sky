import { mkdtemp, readdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { assert, test } from '#test'
import { matchPlace, placeChoiceForRef, placeChoices } from './catalog.ts'

test('place lookup includes unsaved countries, preserves saved identities and never writes during search', async () => {
  const dir = await mkdtemp('/tmp/sky-place-catalog-')
  try {
    const store = await PlaceStore.build(dir)
    const countries = placeChoices(store)
    assert({
      given: 'country names, common abbreviations and a legacy file-shaped reference',
      should: 'resolve to known country identities without creating their files',
      actual: [
        matchPlace({ name: 'France' }, countries).ref,
        matchPlace({ name: 'U.S.A.' }, countries).ref,
        matchPlace({ name: 'UK' }, countries).ref,
        placeChoiceForRef('places/locations/fr.md', countries)?.needsCreation,
        await readdir(dir),
      ],
      expected: ['places/FR', 'places/US', 'places/GB', true, []],
    })
    const file = path.join(dir, 'locations/Custom-France.md')
    store.set(
      file,
      '---\nname: French Republic\nkind: country\nref: places/french-republic\nrefAliases: [places/FR]\n---\n',
    )
    const choices = placeChoices(store)
    assert({
      given: 'a country already saved under a custom identity and former reference',
      should: 'reuse it for the public country name and code without offering a duplicate',
      actual: [
        matchPlace({ name: 'France' }, choices).ref,
        placeChoiceForRef('places/FR', choices)?.path,
        choices.filter((choice) => choice.ref === 'places/FR').length,
      ],
      expected: ['places/french-republic', file, 0],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('place subjects need explicit context to distinguish namesakes and never use fuzzy matches', async () => {
  const dir = await mkdtemp('/tmp/sky-place-context-')
  try {
    const store = await PlaceStore.build(dir)
    store.set(path.join(dir, 'locations/FR/Harbor-City/drink/Cafe.md'), '---\nname: Cafe\nalt: Waterside Cafe\n---\n')
    store.set(path.join(dir, 'locations/US/Foam-City/drink/Cafe.md'), '---\nname: Cafe\n---\n')
    const choices = placeChoices(store)
    assert({
      given: 'two cafes, a unique alias, an explicit country, or an invented spelling',
      should: 'abstain on ambiguity, resolve explicit context, and reject fuzzy or contradictory matches',
      actual: [
        matchPlace({ name: 'Cafe' }, choices).ref,
        matchPlace({ name: 'Cafe' }, choices).candidates.length,
        matchPlace({ name: 'Waterside Cafe' }, choices).ref,
        matchPlace({ name: 'Cafe', context: ['France'] }, choices).ref,
        matchPlace({ name: 'Cafe', context: ['Foam City'] }, choices).ref,
        matchPlace({ name: 'Caffee' }, choices).ref,
        matchPlace({ name: 'Cafe', kind: 'city' }, choices).ref,
      ],
      expected: [
        undefined,
        2,
        'places/FR/Harbor-City/drink/Cafe',
        'places/FR/Harbor-City/drink/Cafe',
        'places/US/Foam-City/drink/Cafe',
        undefined,
        undefined,
      ],
    })
    store.set(path.join(dir, 'locations/FR.md'), '# Unnamed existing notes\n')
    assert({
      given: 'an existing unnamed file at the country destination',
      should: 'withhold automatic creation until the file is repaired',
      actual: placeChoiceForRef('places/FR', placeChoices(store)),
      expected: undefined,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('qualified place names use every written region and country without guessing between namesakes', async () => {
  const dir = await mkdtemp('/tmp/sky-place-qualified-')
  try {
    const store = await PlaceStore.build(dir)
    for (const region of ['CA', 'OR']) {
      store.set(
        path.join(dir, `locations/US/${region}/Harbor-City.md`),
        `---\nname: Harbor City\nalt: Harbor\nkind: city\nlocation: { country: US, region: ${region}, city: Harbor City }\n---\n`,
      )
    }
    const choices = placeChoices(store)
    const city = 'places/US/CA/Harbor-City'
    assert({
      given: 'namesakes with a written state, country, alias, wrong kind, or conflicting context',
      should: 'resolve only exact names whose complete geographic context agrees',
      actual: [
        matchPlace({ name: 'Harbor City' }, choices).ref,
        matchPlace({ name: 'Harbor City, CA' }, choices).ref,
        matchPlace({ name: ' HARBOR , ca , U.S.A. ' }, choices).ref,
        matchPlace({ name: 'Harbor City, CA', context: ['France'] }, choices).ref,
        matchPlace({ name: 'Harbor City, CA', kind: 'venue' }, choices).ref,
        matchPlace({ name: 'Harbor City, Unknown Region' }, choices).ref,
        matchPlace({ name: 'Harbr City, CA' }, choices).ref,
        matchPlace({ name: 'Harbor City CA' }, choices).ref,
      ],
      expected: [undefined, city, city, undefined, undefined, undefined, undefined, undefined],
    })
    store.set(
      path.join(dir, 'locations/CA/Harbor-City.md'),
      '---\nname: Harbor City\nkind: city\nlocation: { country: CA, city: Harbor City }\n---\n',
    )
    const ambiguous = placeChoices(store)
    assert({
      given: 'a state abbreviation that also names another candidate’s country',
      should: 'keep the ambiguity until the source explicitly supplies a distinguishing country',
      actual: [
        matchPlace({ name: 'Harbor City, CA' }, ambiguous).ref,
        matchPlace({ name: 'Harbor City, CA' }, ambiguous).candidates.length,
        matchPlace({ name: 'Harbor City, CA, USA' }, ambiguous).ref,
      ],
      expected: [undefined, 2, city],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('commas inside saved names and aliases survive qualified place lookup', async () => {
  const dir = await mkdtemp('/tmp/sky-place-comma-')
  try {
    const store = await PlaceStore.build(dir)
    const ref = 'places/US/CA/Harbor-City/Tea-Books'
    store.set(
      path.join(dir, 'venue.md'),
      `---\nname: Tea, Books\nalt: ["Books, Tea"]\nref: ${ref}\nlocation: { country: US, region: CA, city: Harbor City }\n---\n`,
    )
    store.set(
      path.join(dir, 'short-name.md'),
      '---\nname: Tea\nref: places/US/OR/Tea\nlocation: { country: US, region: OR }\n---\n',
    )
    const choices = placeChoices(store)
    const mention = { name: 'Tea, Books, Harbor City, CA', kind: 'venue' as const }
    assert({
      given: 'a full name containing a comma, its comma alias, and qualified forms',
      should: 'prefer the full name and longest exact prefix without dropping conflicting qualifiers',
      actual: [
        matchPlace({ name: 'Tea, Books' }, choices).ref,
        matchPlace({ name: 'Books, Tea' }, choices).ref,
        matchPlace(mention, choices).ref,
        matchPlace(mention, choices).mention,
        matchPlace({ name: 'Books, Tea, USA' }, choices).ref,
        matchPlace({ name: 'Tea, Books, OR' }, choices).ref,
      ],
      expected: [ref, ref, ref, mention, ref, undefined],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
