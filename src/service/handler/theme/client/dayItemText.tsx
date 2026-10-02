import { Fragment, useMemo } from 'react'
import { itemEditFields } from '../../day/editingTypes.ts'
import type { DayItem } from './day.tsx'
import { type LinkSite, textParts, type WebLink } from './dayItemLinks.ts'

/** The small mark that says where a chip goes. The chip's words name the site, so the mark is decoration. */
function SiteMark({ site }: { site: LinkSite }) {
  if (site === 'slack')
    return (
      <svg className="sky-item-link-mark" viewBox="0 0 122.8 122.8" aria-hidden="true">
        <path
          fill="#e01e5a"
          d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
        />
        <path
          fill="#36c5f0"
          d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
        />
        <path
          fill="#2eb67d"
          d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
        />
        <path
          fill="#ecb22e"
          d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
        />
      </svg>
    )
  if (site === 'web')
    return (
      <svg className="sky-item-link-mark" data-site="web" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M1.8 8h12.4M8 1.8c2.2 2 2.2 10.4 0 12.4M8 1.8c-2.2 2-2.2 10.4 0 12.4"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    )
  // A page in the file type's color: lines for a document, a grid for a sheet, a frame for slides.
  return (
    <svg className="sky-item-link-mark" data-site={site} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 1h6L13 4.5V14a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="currentColor" />
      <path
        d={
          site === 'doc'
            ? 'M5 7.4h6M5 9.7h6M5 12h4'
            : site === 'sheet'
              ? 'M5 7h6v5.2H5zM5 9.6h6M8 7v5.2'
              : 'M5 7.4h6v4.2H5z'
        }
        fill="none"
        stroke="var(--sky-bg)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WebLinkChip({ link, inert }: { link: WebLink; inert: boolean }) {
  const body = (
    <>
      <SiteMark site={link.site} />
      <span>{link.label}</span>
    </>
  )
  // Inert where a press already means something else: selecting a row, ticking a choice.
  return inert ? (
    <span className="sky-item-link">{body}</span>
  ) : (
    <a className="sky-item-link" href={link.href} target="_blank" rel="noreferrer" title={link.href}>
      {body}
    </a>
  )
}

/**
 * Text that may hold web addresses: the words stay words and each address
 * becomes a chip naming where it goes. `source` is the Markdown to read when
 * `text` has already had a link folded into it.
 */
export function LinkedText({ text, source = text, inert = false }: { text: string; source?: string; inert?: boolean }) {
  const parts = useMemo(() => textParts(source), [source])
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && !(typeof part === 'string' && /^[.,;:!?)]/.test(part)) && ' '}
          {typeof part === 'string' ? (
            <span className="sky-ptext-words">{part}</span>
          ) : (
            <WebLinkChip link={part} inert={inert} />
          )}
        </Fragment>
      ))}
    </>
  )
}

/** A day item's words. A notebook link carries the whole text; web addresses become chips. */
export function ItemText({ item, href, inert = false }: { item: DayItem; href: string | null; inert?: boolean }) {
  if (href) return inert ? <>{item.text}</> : <a href={href}>{item.text}</a>
  return <LinkedText text={item.text} source={itemEditFields(item).text} inert={inert} />
}
