import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { generateTotp } from './totp.ts'

// Public RFC 6238 Appendix B test keys, not credentials for any real account.
const keys = {
  SHA1: '12345678901234567890',
  SHA256: '12345678901234567890123456789012',
  SHA512: '1234567890123456789012345678901234567890123456789012345678901234',
}
const vectors = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
] as const

function base32(text: string): string {
  const bits = [...Buffer.from(text)].map((byte) => byte.toString(2).padStart(8, '0')).join('')
  return (bits.match(/.{1,5}/g) ?? [])
    .map((chunk) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(chunk.padEnd(5, '0'), 2)])
    .join('')
}

test('TOTP matches the published SHA1, SHA256 and SHA512 vectors', () => {
  for (const [seconds, ...expected] of vectors) {
    const at = Instant.fromEpochMilliseconds(seconds * 1000).toString()
    const actual = Object.entries(keys).map(([algorithm, key]) =>
      generateTotp(`otpauth://totp/Example?secret=${base32(key)}&algorithm=${algorithm}&digits=8`, at).code.use(
        (code) => code,
      ),
    )
    assert({ given: `RFC 6238 time ${seconds}`, should: 'match each published algorithm', actual, expected })
  }
})

test('TOTP honors custom periods and returns the actual expiry', () => {
  const code = generateTotp(`otpauth://totp/Example?secret=${base32(keys.SHA1)}&period=60`, '1970-01-01T00:01:59Z')
  assert({
    given: 'a sixty-second period just before its boundary',
    should: 'keep leading zeros and report the boundary',
    actual: [code.code.use((value) => value), code.expiresAt],
    expected: ['287082', '1970-01-01T00:02:00Z'],
  })
})

test('invalid OTP setups never leak their input in errors', () => {
  const inputs = [
    'mock-api-key',
    'otpauth://hotp/Example?secret=JBSWY3DP',
    'otpauth://totp/Example?secret=INVALID1',
    'otpauth://totp/Example?secret=JBSWY3DP&digits=7',
    'otpauth://totp/Example?secret=JBSWY3DP&period=0',
    'otpauth://totp/Example?secret=JBSWY3DP&secret=JBSWY3DP',
    'otpauth://totp/Example?secret=A',
    'otpauth://totp/Example?secret=MZ',
  ]
  for (const input of inputs) {
    let message = ''
    try {
      generateTotp(input)
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'an invalid setup',
      should: 'return a sanitized validation error',
      actual: message,
      expected: 'The credential request is invalid.',
    })
  }
})
