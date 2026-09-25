import { z } from 'zod'
import { normalizePlaceRef } from '#shared/models/Place/reference.ts'
import { placeKinds } from './types.ts'

const text = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !/[\r\n\x00-\x1f]/.test(value), 'Use a single line for this field.')
const website = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true
    try {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
    } catch {
      return false
    }
  }, 'Use a full website URL beginning with https://.')
export const SavePlaceSchema = z.object({
  name: text.min(1),
  kind: z.enum(Object.keys(placeKinds) as [keyof typeof placeKinds, ...(keyof typeof placeKinds)[]]),
  category: text,
  aliases: z.array(text.min(1)).max(50),
  parent: z
    .string()
    .max(2048)
    .refine((value) => !value || Boolean(normalizePlaceRef(value)), 'Choose a saved geographic place.'),
  address: text,
  site: website,
  country: z.string().regex(/^(?:[A-Z]{2})?$/, 'Use a two-letter country code.'),
  region: text,
  city: text,
  subcity: text,
  coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable(),
  googlePlaceId: z
    .string()
    .max(300)
    .regex(/^[A-Za-z0-9_-]*$/),
  googleMapsUrl: website,
  id: z.string().min(1).max(2048).optional(),
  revision: z.string().length(64).optional(),
  notes: z.string().max(80_000).optional(),
  allowNamesake: z.boolean().optional(),
})
