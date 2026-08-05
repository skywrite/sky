import ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import { assert, test } from '#test'
import Person from './mod.ts'

// Test fixtures for sites getter
const sitesGetterFixtures = [
  {
    description: 'empty by default',
    yaml: { name: 'John Doe' },
    expectedSize: 0,
    expectedContains: [],
  },
  {
    description: 'parses array from YAML',
    yaml: {
      name: 'John Doe',
      sites: ['https://example.com', 'https://twitter.com/johndoe'],
    },
    expectedSize: 2,
    expectedContains: ['https://example.com', 'https://twitter.com/johndoe'],
  },
  {
    description: 'parses semicolon-separated string',
    yaml: {
      name: 'John Doe',
      sites: 'https://example.com; https://github.com/johndoe',
    },
    expectedSize: 2,
    expectedContains: ['https://example.com', 'https://github.com/johndoe'],
  },
  {
    description: 'handles undefined sites',
    yaml: {
      name: 'Jane Doe',
      sites: undefined,
    },
    expectedSize: 0,
    expectedContains: [],
  },
  {
    description: 'handles null sites',
    yaml: {
      name: 'Jane Doe',
      sites: null,
    },
    expectedSize: 0,
    expectedContains: [],
  },
]

sitesGetterFixtures.forEach((fixture) => {
  test(`Person.sites - ${fixture.description}`, () => {
    const person = Person.create(fixture.yaml)

    assert({
      given: fixture.description,
      should: `have ${fixture.expectedSize} site(s)`,
      actual: person.sites.size,
      expected: fixture.expectedSize,
    })

    fixture.expectedContains.forEach((site) => {
      assert({
        given: fixture.description,
        should: `contain ${site}`,
        actual: person.sites.has(site),
        expected: true,
      })
    })
  })
})

// Test fixtures for setSites
const setSitesFixtures = [
  {
    description: 'sets sites from ImmutableSet',
    initialYaml: { name: 'John Doe' },
    sitesToSet: ['https://example.com', 'https://linkedin.com/in/johndoe'],
    expectedSize: 2,
    expectedContains: ['https://example.com'],
  },
  {
    description: 'removes sites when empty',
    initialYaml: { name: 'John Doe', sites: ['https://example.com'] },
    sitesToSet: [],
    expectedSize: 0,
    yamlShouldBeUndefined: true,
  },
  {
    description: 'replaces existing sites',
    initialYaml: { name: 'John Doe', sites: ['https://old.com'] },
    sitesToSet: ['https://new.com', 'https://updated.com'],
    expectedSize: 2,
    expectedContains: ['https://new.com', 'https://updated.com'],
  },
]

setSitesFixtures.forEach((fixture) => {
  test(`Person.setSites - ${fixture.description}`, () => {
    const person = Person.create(fixture.initialYaml)
    const sites = ImmutableSet._fromArray(ImmutableSet<string>, fixture.sitesToSet)
    const updated = person.setSites(sites)

    assert({
      given: fixture.description,
      should: `have ${fixture.expectedSize} site(s)`,
      actual: updated.sites.size,
      expected: fixture.expectedSize,
    })

    if (fixture.yamlShouldBeUndefined) {
      assert({
        given: fixture.description,
        should: 'have no sites field in YAML',
        actual: updated.yaml['sites'],
        expected: undefined,
      })
    }

    if (fixture.expectedContains) {
      fixture.expectedContains.forEach((site) => {
        assert({
          given: fixture.description,
          should: `contain ${site}`,
          actual: updated.sites.has(site),
          expected: true,
        })
      })
    }
  })
})

// Test fixtures for addSite
const addSiteFixtures = [
  {
    description: 'adds single site string',
    initialYaml: { name: 'John Doe' },
    siteToAdd: 'https://example.com',
    isString: true,
    expectedSize: 1,
    expectedContains: ['https://example.com'],
  },
  {
    description: 'adds semicolon-separated sites',
    initialYaml: { name: 'John Doe' },
    siteToAdd: 'https://example.com; https://github.com/johndoe',
    isString: true,
    expectedSize: 2,
    expectedContains: ['https://example.com', 'https://github.com/johndoe'],
  },
  {
    description: 'adds ImmutableSet of sites',
    initialYaml: { name: 'John Doe', sites: ['https://example.com'] },
    siteToAdd: ['https://twitter.com/johndoe', 'https://linkedin.com/in/johndoe'],
    isString: false,
    expectedSize: 3,
    expectedContains: ['https://example.com', 'https://twitter.com/johndoe'],
  },
  {
    description: 'deduplicates sites',
    initialYaml: { name: 'John Doe', sites: ['https://example.com'] },
    siteToAdd: 'https://example.com',
    isString: true,
    expectedSize: 1,
    expectedContains: ['https://example.com'],
  },
  {
    description: 'adds to empty sites',
    initialYaml: { name: 'John Doe' },
    siteToAdd: 'https://first.com; https://second.com',
    isString: true,
    expectedSize: 2,
    expectedContains: ['https://first.com', 'https://second.com'],
  },
]

addSiteFixtures.forEach((fixture) => {
  test(`Person.addSite - ${fixture.description}`, () => {
    const person = Person.create(fixture.initialYaml)

    let updated: Person
    if (fixture.isString) {
      updated = person.addSite(fixture.siteToAdd as string)
    } else {
      const sites = ImmutableSet._fromArray(ImmutableSet<string>, fixture.siteToAdd as string[])
      updated = person.addSite(sites)
    }

    assert({
      given: fixture.description,
      should: `have ${fixture.expectedSize} site(s)`,
      actual: updated.sites.size,
      expected: fixture.expectedSize,
    })

    fixture.expectedContains.forEach((site) => {
      assert({
        given: fixture.description,
        should: `contain ${site}`,
        actual: updated.sites.has(site),
        expected: true,
      })
    })
  })
})

// Test fixtures for edge cases
const edgeCaseFixtures = [
  {
    description: 'round trip through markdown',
    yaml: {
      name: 'John Doe',
      sites: ['https://example.com', 'https://twitter.com/johndoe'],
    },
    testRoundTrip: true,
    expectedSize: 2,
    expectedContains: ['https://example.com', 'https://twitter.com/johndoe'],
  },
  {
    description: 'immutability',
    yaml: {
      name: 'John Doe',
      sites: ['https://example.com'],
    },
    testImmutability: true,
    siteToAdd: 'https://twitter.com/johndoe',
    originalSize: 1,
    updatedSize: 2,
  },
]

edgeCaseFixtures.forEach((fixture) => {
  test(`Person sites - ${fixture.description}`, () => {
    if (fixture.testRoundTrip) {
      const person = Person.create(fixture.yaml)
      const markdown = person.toMarkdown()
      const loaded = Person.fromMarkdown(markdown)

      assert({
        given: fixture.description,
        should: `preserve ${fixture.expectedSize} site(s)`,
        actual: loaded.sites.size,
        expected: fixture.expectedSize,
      })

      fixture.expectedContains?.forEach((site) => {
        assert({
          given: fixture.description,
          should: `preserve ${site}`,
          actual: loaded.sites.has(site),
          expected: true,
        })
      })
    }

    if (fixture.testImmutability) {
      const person = Person.create(fixture.yaml)
      const updated = person.addSite(fixture.siteToAdd!)

      assert({
        given: 'original person after addSite',
        should: `still have ${fixture.originalSize} site(s)`,
        actual: person.sites.size,
        expected: fixture.originalSize,
      })

      assert({
        given: 'updated person after addSite',
        should: `have ${fixture.updatedSize} site(s)`,
        actual: updated.sites.size,
        expected: fixture.updatedSize,
      })
    }
  })
})
