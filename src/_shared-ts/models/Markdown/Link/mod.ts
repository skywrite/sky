import type { Links, Tokens, TokensList } from 'marked'

// Design: src/_shared-ts/models/Markdown/docs/README.md

export type Link = {
  label: string
  href: string
  title?: string | null
}

// The TokensList object has a `links` field at its top most
// useful for when you have tokens for an entire markdown document
export function fetchLinksFromTokensList(tokens: TokensList): Map<string, Link> {
  const linkMap: Map<string, Link> = new Map()

  Object.entries(tokens.links).forEach(([label, { title, href }]) => {
    const linkObj: Link = { label, href }
    if (title) linkObj.title = title
    linkMap.set(label, linkObj)
  })

  return linkMap
}

// this actually iterates through tokens looking for links
// useful if you have a subset of markdown tokens
export function fetchLinksFromTokens(tokens: Tokens.Generic[], referenceLinks?: Map<string, Link>): Map<string, Link> {
  const linkMap: Map<string, Link> = referenceLinks ?? new Map()

  for (const token of tokens) {
    if (token.type === 'link') {
      // A reference link has a text and a label. `[the deck][deck]` files
      // under `deck`, the key its definition line uses and the key
      // `Document.extractReferenceLabels` reads off the item — so a list's
      // links resolve for either form. `[deck][]` is its own label.
      const regex = /\[(?<text>[^\]]+)\]\[(?<ref>[^\]]*)\]$/
      const groups = regex.exec(token.raw)?.groups
      const label = (groups?.ref || groups?.text)?.trim()
      if (label) {
        const href = token.href
        const title = token.title

        const linkObj: Link = { label, href }
        if (title) linkObj.title = title

        linkMap.set(label, linkObj)
      }
    }

    if (token?.tokens) fetchLinksFromTokens(token.tokens, linkMap)
  }

  return linkMap
}

export function linkMapToTokenLinks(links: Map<string, Link>): Links {
  const linkObj: Links = {}

  for (const [label, link] of links.entries()) {
    linkObj[label] = {
      ...link,
    }
  }

  return linkObj
}

export function mergeLinkMaps(linkMaps: Map<string, Link>[]): Map<string, Link> {
  const newMap = new Map<string, Link>()

  if (linkMaps.length < 1) throw new Error(`linkMaps length is not greater than equal 1 ${linkMaps?.length}`)

  linkMaps.forEach((linkMap) => {
    linkMap.forEach((link, refLabel) => {
      if (newMap.has(refLabel)) return
      newMap.set(refLabel, link)
    })
  })

  return newMap
}
