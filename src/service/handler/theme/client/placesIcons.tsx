import type { ReactNode } from 'react'
import type { PlaceFields } from '../../places/types.ts'

const paths: Record<string, ReactNode> = {
  pin: (
    <>
      <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6ZM9 3v15M15 6v15" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  right: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  external: <path d="M14 3h7v7M21 3l-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />,
  coffee: <path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8ZM16 8h2a3 3 0 0 1 0 6h-2M3 22h16M7 2v2M11 2v2" />,
  building: <path d="M4 21V3h12v18M16 10h4v11M2 21h20M8 7h4M8 11h4M8 15h4" />,
  home: <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" />,
  bed: <path d="M3 18V8M21 18V8M3 13h18v6H3ZM5 13V5h14v8M8 9h3v4M13 9h3v4M3 19v2M21 19v2" />,
  utensils: <path d="M6 3v6m-3-6v4a3 3 0 0 0 6 0V3M6 10v11M19 3c-4 0-5 5-5 9h5M19 3v18" />,
  book: <path d="M12 6C9 3 4 4 3 5v15c3-2 6-2 9 0 3-2 6-2 9 0V5c-3-2-6-2-9 1ZM12 6v14" />,
  city: <path d="M3 21V9h8v12M11 21V3h9v18M1 21h22M6 13h2M6 17h2M14 7h3M14 11h3M14 15h3" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  tree: <path d="m12 2-7 9h4l-5 6h16l-5-6h4l-7-9ZM12 17v5" />,
  camera: (
    <>
      <path d="M8 5l2-2h4l2 2h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2h4Z" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  bag: <path d="M4 7h16l1 14H3L4 7ZM8 8V6a4 4 0 0 1 8 0v2" />,
  plane: <path d="m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2" />,
  dumbbell: <path d="M2 9v6M5 6v12M5 12h14M19 6v12M22 9v6" />,
  medical: <path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5V3Z" />,
  worship: <path d="M12 2v6M9 5h6M4 21V12l8-5 8 5v9H4ZM9 21v-5a3 3 0 0 1 6 0v5" />,
  stadium: (
    <>
      <ellipse cx="12" cy="8" rx="10" ry="4" />
      <path d="M2 8v8c0 5 20 5 20 0V8M6 12v7M12 12v8M18 12v7M5 5V2M19 5V2" />
    </>
  ),
  activity: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />,
  neighborhood: <path d="m2 9 5-4 5 4M3 8v12h8V8M7 20v-5M13 5l4-3 5 4M14 5v15h7V5M17 9h1M17 13h1M17 17h1" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2 6-6 2 2-6 6-2Z" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  edit: <path d="m15 4 5 5-11 11-6 1 1-6L15 4ZM13 6l5 5" />,
  note: <path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M17 2v6M14 5h6M7 12h8M7 16h6" />,
  document: <path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h6" />,
  people: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
}
export function PlaceIcon({ name = 'pin', size = 20 }: { name?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.pin}
    </svg>
  )
}
export function placeIconName(place: Pick<PlaceFields, 'kind' | 'category'>) {
  return place.kind !== 'venue'
    ? { country: 'globe', region: 'map', city: 'city', neighborhood: 'neighborhood', area: 'compass' }[place.kind]
    : (
        {
          drink: 'coffee',
          eat: 'utensils',
          stay: 'bed',
          office: 'building',
          residence: 'home',
          visit: 'camera',
          park: 'tree',
          shop: 'bag',
          travel: 'plane',
          learn: 'book',
          fitness: 'dumbbell',
          medical: 'medical',
          church: 'worship',
          stadium: 'stadium',
          do: 'activity',
        } as Record<string, string>
      )[place.category] || 'pin'
}
export function PlaceAvatar({
  place,
  large = false,
}: {
  place: Pick<PlaceFields, 'kind' | 'category'>
  large?: boolean
}) {
  return (
    <span
      className="sky-places-avatar"
      data-kind={place.kind === 'venue' ? place.category : place.kind}
      data-large={large}
    >
      <PlaceIcon name={placeIconName(place)} size={large ? 32 : 23} />
    </span>
  )
}
