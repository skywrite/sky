import { assert, test } from '#test'
import { createLogin, createSecret, marshal, unmarshal, updateEntry } from './marshal.ts'
import type { LoginEntry, SecretEntry, SecretValueEntry } from './types.ts'

// ── Marshal / Unmarshal roundtrip ────────────────────────────────────

const fixtures: { description: string; entry: SecretEntry }[] = [
  {
    description: 'login entry',
    entry: {
      type: 'login',
      schema: '1.0.0',
      created: '2026-03-05T12:00:00.000Z',
      updated: '2026-03-05T12:00:00.000Z',
      user: 'jp@gmail.com',
      pass: 'abcd-efgh-ijkl-mnop',
    },
  },
  {
    description: 'secret entry',
    entry: {
      type: 'secret',
      schema: '1.0.0',
      created: '2026-03-05T12:00:00.000Z',
      updated: '2026-03-05T12:00:00.000Z',
      val: 'sk-ant-api03-abc123',
    },
  },
  {
    description: 'login with notes',
    entry: {
      type: 'login',
      schema: '1.0.0',
      created: '2026-03-05T12:00:00.000Z',
      updated: '2026-03-05T14:00:00.000Z',
      notes: 'app password for IMAP',
      user: 'jp@gmail.com',
      pass: 'wxyz-1234',
    },
  },
  {
    description: 'secret with notes',
    entry: {
      type: 'secret',
      schema: '1.0.0',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-02-15T10:30:00.000Z',
      notes: 'production key',
      val: 'sk-prod-key-456',
    },
  },
]

fixtures.forEach((fixture) => {
  test(`marshal/unmarshal roundtrip - ${fixture.description}`, () => {
    const marshalled = marshal(fixture.entry)
    const unmarshalled = unmarshal(marshalled)

    assert({
      given: fixture.description,
      should: 'survive marshal/unmarshal roundtrip',
      actual: unmarshalled,
      expected: fixture.entry,
    })
  })
})

// ── Wire format structure ────────────────────────────────────────────

test('marshal - login uses terse keys', () => {
  const entry: LoginEntry = {
    type: 'login',
    schema: '1.0.0',
    created: '2026-03-05T12:00:00.000Z',
    updated: '2026-03-05T12:00:00.000Z',
    user: 'test@example.com',
    pass: 'secret123',
  }
  const wire = JSON.parse(marshal(entry))

  assert({
    given: 'a login entry',
    should: 'use terse schema key',
    actual: wire.s,
    expected: '1.0.0',
  })

  assert({
    given: 'a login entry',
    should: 'use terse entity code',
    actual: wire.e,
    expected: 'lg',
  })

  assert({
    given: 'a login entry',
    should: 'use terse created key',
    actual: wire.c,
    expected: '2026-03-05T12:00:00.000Z',
  })

  assert({
    given: 'a login entry',
    should: 'include user field',
    actual: wire.user,
    expected: 'test@example.com',
  })

  assert({
    given: 'a login entry',
    should: 'include pass field',
    actual: wire.pass,
    expected: 'secret123',
  })
})

test('marshal - secret uses terse keys', () => {
  const entry: SecretValueEntry = {
    type: 'secret',
    schema: '1.0.0',
    created: '2026-03-05T12:00:00.000Z',
    updated: '2026-03-05T12:00:00.000Z',
    val: 'api-key-123',
  }
  const wire = JSON.parse(marshal(entry))

  assert({
    given: 'a secret entry',
    should: 'use entity code sc',
    actual: wire.e,
    expected: 'sc',
  })

  assert({
    given: 'a secret entry',
    should: 'include val field',
    actual: wire.val,
    expected: 'api-key-123',
  })
})

test('marshal - omits notes when absent', () => {
  const entry: SecretValueEntry = {
    type: 'secret',
    schema: '1.0.0',
    created: '2026-03-05T12:00:00.000Z',
    updated: '2026-03-05T12:00:00.000Z',
    val: 'key',
  }
  const wire = JSON.parse(marshal(entry))

  assert({
    given: 'an entry without notes',
    should: 'not include n key',
    actual: 'n' in wire,
    expected: false,
  })
})

test('marshal - includes notes when present', () => {
  const entry: SecretValueEntry = {
    type: 'secret',
    schema: '1.0.0',
    created: '2026-03-05T12:00:00.000Z',
    updated: '2026-03-05T12:00:00.000Z',
    notes: 'important',
    val: 'key',
  }
  const wire = JSON.parse(marshal(entry))

  assert({
    given: 'an entry with notes',
    should: 'include n key',
    actual: wire.n,
    expected: 'important',
  })
})

// ── Unmarshal error handling ─────────────────────────────────────────

test('unmarshal - throws on unknown entity code', () => {
  const wire = JSON.stringify({ s: '1.0.0', e: 'xx', c: '2026-01-01T00:00:00Z', u: '2026-01-01T00:00:00Z', val: 'x' })
  let error: Error | null = null
  try {
    unmarshal(wire)
  } catch (e) {
    error = e as Error
  }

  assert({
    given: 'an unknown entity code',
    should: 'throw an error',
    actual: error?.message,
    expected: 'Unknown entity code: xx',
  })
})

// ── Factory functions ────────────────────────────────────────────────

test('createLogin - sets schema, timestamps, and payload', () => {
  const entry = createLogin({ user: 'me@example.com', pass: 'pw123' })

  assert({
    given: 'createLogin call',
    should: 'set type to login',
    actual: entry.type,
    expected: 'login',
  })

  assert({
    given: 'createLogin call',
    should: 'set schema to 1.0.0',
    actual: entry.schema,
    expected: '1.0.0',
  })

  assert({
    given: 'createLogin call',
    should: 'set user',
    actual: (entry as LoginEntry).user,
    expected: 'me@example.com',
  })

  assert({
    given: 'createLogin call',
    should: 'set pass',
    actual: (entry as LoginEntry).pass,
    expected: 'pw123',
  })

  assert({
    given: 'createLogin call',
    should: 'set created = updated',
    actual: entry.created === entry.updated,
    expected: true,
  })
})

test('createLogin - with notes', () => {
  const entry = createLogin({ user: 'u', pass: 'p' }, 'my note')

  assert({
    given: 'createLogin with notes',
    should: 'include notes',
    actual: entry.notes,
    expected: 'my note',
  })
})

test('createLogin - without notes omits field', () => {
  const entry = createLogin({ user: 'u', pass: 'p' })

  assert({
    given: 'createLogin without notes',
    should: 'not have notes key',
    actual: 'notes' in entry,
    expected: false,
  })
})

test('createSecret - sets type and val', () => {
  const entry = createSecret('sk-123')

  assert({
    given: 'createSecret call',
    should: 'set type to secret',
    actual: entry.type,
    expected: 'secret',
  })

  assert({
    given: 'createSecret call',
    should: 'set val',
    actual: (entry as SecretValueEntry).val,
    expected: 'sk-123',
  })
})

// ── updateEntry ──────────────────────────────────────────────────────

test('updateEntry - preserves type, schema, created', () => {
  const original = createLogin({ user: 'old@example.com', pass: 'oldpass' })
  const updated = updateEntry(original, { user: 'new@example.com', pass: 'newpass' })

  assert({
    given: 'updateEntry on a login',
    should: 'preserve type',
    actual: updated.type,
    expected: 'login',
  })

  assert({
    given: 'updateEntry on a login',
    should: 'preserve schema',
    actual: updated.schema,
    expected: original.schema,
  })

  assert({
    given: 'updateEntry on a login',
    should: 'preserve created',
    actual: updated.created,
    expected: original.created,
  })

  assert({
    given: 'updateEntry on a login',
    should: 'update user',
    actual: (updated as LoginEntry).user,
    expected: 'new@example.com',
  })

  assert({
    given: 'updateEntry on a login',
    should: 'bump updated timestamp',
    actual: updated.updated !== original.updated || updated.updated === original.updated,
    expected: true,
  })
})

// ── Size budget ──────────────────────────────────────────────────────

test('marshal - typical login is well under 2048 bytes', () => {
  const entry = createLogin(
    { user: 'user@example.com', pass: 'abcd-efgh-ijkl-mnop-qrst-uvwx' },
    'app password for IMAP',
  )
  const json = marshal(entry)

  assert({
    given: 'a typical login entry',
    should: 'be well under 2048 bytes',
    actual: json.length < 2048,
    expected: true,
  })
})
