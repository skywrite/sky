import { slugify } from '#lib/string/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { buildPlacePath, toDisplayString } from './path.ts'
import type { PlaceCreateInput, PlaceLocation } from './types.ts'

export default class PlaceDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    super(yaml, markdown, yamlError)
  }

  /** Preferred key order for place document YAML frontmatter */
  static override yamlKeyOrder = ['name', 'type', 'address', 'site', 'location', 'googleMapsUrl']

  // Typed accessors for YAML fields

  get name(): string {
    return (this.yaml['name'] as string) ?? ''
  }

  get type(): string {
    return (this.yaml['type'] as string) ?? ''
  }

  get address(): string | undefined {
    const val = this.yaml['address']
    return typeof val === 'string' ? val : undefined
  }

  get site(): string | undefined {
    const val = this.yaml['site']
    return typeof val === 'string' ? val : undefined
  }

  get googleMapsUrl(): string | undefined {
    const val = this.yaml['googleMapsUrl']
    if (typeof val === 'string') return val

    // Legacy format: GoogleMaps.url
    const gm = this.yaml['GoogleMaps']
    if (gm && typeof gm === 'object') {
      const url = (gm as Record<string, unknown>)['url']
      if (typeof url === 'string') return url
    }

    return undefined
  }

  get location(): PlaceLocation | undefined {
    const loc = this.yaml['location']
    if (!loc || typeof loc !== 'object') return undefined

    const locObj = loc as Record<string, unknown>
    const latitude = locObj['latitude']
    const longitude = locObj['longitude']

    // Latitude and longitude are required
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return undefined
    }

    // New format: country/region/city/subcity are in location object
    let country = locObj['country'] as string | undefined
    let region = locObj['region'] as string | undefined
    let city = locObj['city'] as string | undefined
    const subcity = locObj['subcity'] as string | undefined

    // Legacy format: fall back to addressComponents
    if (!country) {
      const ac = this.yaml['addressComponents']
      if (ac && typeof ac === 'object') {
        const acObj = ac as Record<string, unknown>
        country = acObj['country'] as string | undefined
        region = region || (acObj['state'] as string | undefined) || undefined
        city = city || (acObj['city'] as string | undefined) || undefined
      }
    }

    return {
      country: country ?? '',
      region,
      city,
      subcity,
      latitude,
      longitude,
      plusCode: locObj['plusCode'] as string | undefined,
    }
  }

  get slug(): string {
    return slugify(this.name)
  }

  get slugPreserveCase(): string {
    return slugify(this.name, { preserveCase: true })
  }

  /**
   * Build the canonical path for this place (for rel: references).
   * Includes the `places/` prefix for resolution.
   * @example "places/US/NY/New-York/Manhattan/drink/Ty-Bar"
   */
  toPath(): string {
    const location = this.location
    if (!location) {
      throw new Error('Cannot build path: location is undefined')
    }
    const basePath = buildPlacePath(location, this.type)
    return `places/${basePath}/${this.slugPreserveCase}`
  }

  /**
   * Build the file path for this place (without `places/` prefix).
   * Use this when joining with DIR_PLACES_LOCATIONS.
   * @example "US/NY/New-York/Manhattan/drink/Ty-Bar"
   */
  toFilePath(): string {
    const location = this.location
    if (!location) {
      throw new Error('Cannot build path: location is undefined')
    }
    const basePath = buildPlacePath(location, this.type)
    return `${basePath}/${this.slugPreserveCase}`
  }

  /**
   * Get a human-readable display string for this place's location.
   * @example "Manhattan, New York, NY"
   */
  toLocationDisplayString(): string {
    const location = this.location
    if (!location) return ''
    return toDisplayString(location)
  }

  /**
   * Generate a default markdown template for a new place
   */
  static createTemplate(yaml: Record<string, unknown>): string {
    const name = yaml['name'] as string
    return `# ${name}

## Overview
`
  }

  /**
   * Create a new PlaceDocument from input data
   */
  static create(input: PlaceCreateInput): PlaceDocument {
    const yaml: Record<string, unknown> = {
      name: input.name,
      type: input.type,
      address: input.address ?? null,
      site: input.site ?? null,
      location: {
        country: input.location.country,
        region: input.location.region ?? null,
        city: input.location.city ?? null,
        subcity: input.location.subcity ?? null,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        plusCode: input.location.plusCode ?? null,
      },
      googleMapsUrl: input.googleMapsUrl ?? null,
    }

    const markdown = PlaceDocument.createTemplate(yaml)
    return new PlaceDocument(yaml, markdown)
  }

  /**
   * Load a PlaceDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): PlaceDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new PlaceDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
