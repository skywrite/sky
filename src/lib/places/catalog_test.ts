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
