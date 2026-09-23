import { z } from 'zod'
import { PlainDate, PlainYearMonth } from '#universal/dates/nbdt/mod.ts'

const text = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !/[\r\n\x00-\x1f]/.test(value), 'Use a single line for this field.')
const texts = z.array(text.min(1)).max(50)
const url = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
  }, 'Use a full website URL beginning with https://.')
const org = z.object({
  name: text.min(1),
  id: z.string().max(2048).optional(),
  linkedin: url.optional(),
  create: z.boolean().optional(),
})
const met = text.refine((value) => {
  if (!value || /^\d{4}$/.test(value)) return true
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return PlainDate.from(value).ymd === value
    if (/^\d{4}-\d{2}$/.test(value)) return PlainYearMonth.from(value).toString() === value
  } catch {
    return false
  }
  return false
}, 'Use YYYY, YYYY-MM, or YYYY-MM-DD for when you met.')

export const SaveProfileSchema = z.object({
  type: z.enum(['person', 'org']),
  name: text.min(1),
  aliases: texts,
  title: text,
  location: text,
  emailPersonal: z.array(z.string().trim().email()).max(30),
  emailBusiness: z.array(z.string().trim().email()).max(30),
  sites: z.array(url).max(50),
  met,
  current: z.array(org).max(30),
  past: z.array(org).max(100),
  kind: z.enum(['company', 'nonprofit', 'government', 'unknown']),
  sector: text,
  id: z.string().min(1).max(2048).optional(),
  revision: z.string().length(64).optional(),
  notes: z.string().max(80_000).optional(),
  allowNamesake: z.boolean().optional(),
})
