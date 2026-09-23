import { assert, test } from '#test'
import { groundedDraft, type ExtractedProfile, type ProfileEvidence } from './extract.ts'
import { linkedInUrl } from './types.ts'

test('LinkedIn destinations only accept profile or company pages on LinkedIn', () => {
  const invalid = [
    'https://linkedin.com.example.com/in/test/',
    'http://www.linkedin.com/in/test/',
    'https://www.linkedin.com:9443/in/test/',
    'https://user:pass@linkedin.com/in/test/',
    'https://www.linkedin.com/feed/',
    'file:///in/test',
    'https://www.linkedin.com/in/a%2Fb/',
  ]
  assert({
    given: 'arbitrary destinations masquerading as profile links',
    should: 'reject every one and canonicalize a real profile path',
    actual: [
      invalid.every((url) => {
        try {
          linkedInUrl(url)
          return false
        } catch {
          return true
        }
      }),
      linkedInUrl('https://uk.linkedin.com/in/jane-doe-example/?trk=sample#about'),
    ],
    expected: [true, 'https://www.linkedin.com/in/jane-doe-example/'],
  })
})

test('LinkedIn suggestions retain multiple jobs and reject unsupported fields and invented organization URLs', () => {
  const source: ProfileEvidence = {
    url: 'https://www.linkedin.com/in/jane-doe-example/',
    name: 'Jane Doe',
    text: 'Jane Doe\nResearch lead\nPortland\nAtlas · Research lead · 2022 – Present\nCedar Foundation · Advisor · 2024 – Present\nNorthstar · Designer · 2018 – 2022\nWorks on accessible design.',
    companies: [{ name: 'Atlas', url: 'https://www.linkedin.com/company/atlas-example/' }],
  }
  const extracted: ExtractedProfile = {
    title: { value: 'Research lead', evidence: 'Research lead' },
    location: { value: 'London', evidence: 'Never seen on this profile' },
    notes: [
      { value: 'Works on accessible design.', evidence: 'Works on accessible design.' },
      { value: 'Invented biography', evidence: 'Not on this page' },
    ],
    organizations: [
      {
        name: 'Atlas',
        url: 'https://www.linkedin.com/company/atlas-example/',
        status: 'current',
        evidence: 'Atlas · Research lead · 2022 – Present',
      },
      {
        name: 'Cedar Foundation',
        url: 'https://www.linkedin.com/company/invented/',
        status: 'current',
        evidence: 'Cedar Foundation · Advisor · 2024 – Present',
      },
      { name: 'Northstar', url: '', status: 'past', evidence: 'Northstar · Designer · 2018 – 2022' },
      { name: 'Unknown', url: '', status: 'current', evidence: 'Never seen' },
    ],
  }
  const draft = groundedDraft(source, extracted)
  assert({
    given: 'suggestions containing supported and hallucinated facts',
    should: 'keep grounded current and former employers, and leave unknown facts blank',
    actual: draft,
    expected: {
      url: source.url,
      name: 'Jane Doe',
      title: 'Research lead',
      location: '',
      about: '- Works on accessible design.',
      current: [
        { name: 'Atlas', linkedin: 'https://www.linkedin.com/company/atlas-example/' },
        { name: 'Cedar Foundation' },
      ],
      past: [{ name: 'Northstar' }],
    },
  })
})
