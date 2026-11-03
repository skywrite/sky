/** The note editor's 1.6px outline icons, drawn on Sky's 24px grid like the sidebar's. */

const PATHS = {
  note: ['M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3', 'm13.5 6.5 3 3'],
  bold: ['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M13 12h1a3.5 3.5 0 0 1 0 7H7v-7'],
  italic: ['M11 5h6M7 19h6M14 5l-4 14'],
  strike: [
    'M5 12h14',
    'M16 6.5C15.3 5.6 14 5 12.4 5H11a3.5 3.5 0 0 0-2.2 6.2M8 17.5c.7.9 2 1.5 3.6 1.5H13a3.5 3.5 0 0 0 3-5.3',
  ],
  code: ['m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16'],
  link: ['M9 15l6-6', 'M11 6l.5-.5a5 5 0 0 1 7 7l-.5.5', 'M13 18l-.5.5a5 5 0 0 1-7-7l.5-.5'],
  bullets: ['M9 6h11M9 12h11M9 18h11', 'M4.5 6h.01M4.5 12h.01M4.5 18h.01'],
  numbers: [
    'M11 6h9M11 12h9M11 18h9',
    'M4 4.5h1.5V9M4 9h3M4 14.8c.3-.6.9-.9 1.5-.9.9 0 1.5.6 1.5 1.3 0 1.2-3 2.2-3 3.8h3',
  ],
  tasks: [
    'm3.5 6 1.5 1.5L8 4.5M3.5 13l1.5 1.5L8 11.5M12 6h8M12 13h8M12 19.5h8',
    'M4.5 17.5h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z',
  ],
  quote: [
    'M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.7-1.3 4.3-4 5',
    'M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.7-1.3 4.3-4 5',
  ],
  codeblock: [
    'M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z',
    'm10 10-2 2 2 2M14 10l2 2-2 2',
  ],
  table: [
    'M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z',
    'M3 10h18M3 15h18M10 4v16',
  ],
  divider: ['M3 12h18'],
  image: [
    'M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z',
    'M9 8.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z',
    'm21 16-5-5-9 9',
  ],
  heading1: ['M4 6v12M12 6v12M4 12h8M16.5 9 19 7.5V18'],
  heading2: ['M3 6v12M11 6v12M3 12h8M15 10a2.2 2.2 0 0 1 4.3.6c0 1.6-4.3 3.5-4.3 7.4h4.6'],
  heading3: ['M3 6v12M11 6v12M3 12h8M15 8.5a2.2 2.2 0 1 1 2.3 3.5 2.4 2.4 0 1 1-2.4 3.8'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  clock: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M12 7v5l3 2'],
  chevron: ['m6 9 6 6 6-6'],
  copy: [
    'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
    'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  ],
  file: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2'],
} as const

export type FormatIconName = keyof typeof PATHS

/** One icon, drawn in the text's color; decorative, so the control around it carries the name. */
export function FormatIcon({ name, size = 19 }: { name: FormatIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'bold' ? 2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
