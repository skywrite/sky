import { assert, test } from '#test'
import { type EntityContext, formatEntityContext } from './_entityContext.ts'

// ---------------------------------------------------------------------------
// formatEntityContext
// ---------------------------------------------------------------------------

test('formatEntityContext - all sections populated', () => {
  const ctx: EntityContext = {
    projects: ['Camino-Acme-Pay', 'Website-Redesign'],
    decisions: ['Hire-CTO', 'Office-Location'],
    goals: ['Health: Run a marathon by June', 'Leadership: Ship v2 by March'],
    recentTags: ['Acme/Product/GTM', 'Assets/Crypto/BTC'],
  }
  const result = formatEntityContext(ctx)

  assert({
    given: 'all sections populated',
    should: 'contain the heading',
    actual: result.includes('## Active Notebook Entities'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Open Projects section',
    actual: result.includes('### Open Projects'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain project names',
    actual: result.includes('Camino-Acme-Pay, Website-Redesign'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Pending Decisions section',
    actual: result.includes('### Pending Decisions'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain decision names',
    actual: result.includes('Hire-CTO, Office-Location'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Active Goals section',
    actual: result.includes('### Active Goals'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain goal lines as bullet points',
    actual: result.includes('- Health: Run a marathon by June'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Recent Tags section',
    actual: result.includes('### Recent Tags (last 6 months)'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain tag names',
    actual: result.includes('Acme/Product/GTM, Assets/Crypto/BTC'),
    expected: true,
  })
})

test('formatEntityContext - empty sections omitted', () => {
  const ctx: EntityContext = {
    projects: ['Only-Project'],
    decisions: [],
    goals: [],
    recentTags: ['Some/Tag'],
  }
  const result = formatEntityContext(ctx)

  assert({
    given: 'decisions and goals empty',
    should: 'not contain Pending Decisions section',
    actual: result.includes('### Pending Decisions'),
    expected: false,
  })

  assert({
    given: 'decisions and goals empty',
    should: 'not contain Active Goals section',
    actual: result.includes('### Active Goals'),
    expected: false,
  })

  assert({
    given: 'projects and tags present',
    should: 'contain Open Projects section',
    actual: result.includes('### Open Projects'),
    expected: true,
  })

  assert({
    given: 'projects and tags present',
    should: 'contain Recent Tags section',
    actual: result.includes('### Recent Tags'),
    expected: true,
  })
})

test('formatEntityContext - all empty returns empty string', () => {
  const ctx: EntityContext = {
    projects: [],
    decisions: [],
    goals: [],
    recentTags: [],
  }
  const result = formatEntityContext(ctx)

  assert({
    given: 'all sections empty',
    should: 'return empty string',
    actual: result,
    expected: '',
  })
})
