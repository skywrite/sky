import sharp from 'sharp'
import type {
  EvaluationBounds,
  EvaluationColorTarget,
  ImageEvaluationDefinition,
  ImageEvaluationFixture,
} from './types.ts'

const size = 1024
const orange = '#f07820'
const blue = '#2867b2'
const magenta = '#c040a0'
const ink = '#243447'

export const imageEvaluationCases: readonly ImageEvaluationDefinition[] = [
  {
    id: 'shaded-object',
    medium: 'synthetic_scene',
    prompt:
      'In this synthetic still life, replace only the blue lampshade with a wider orange fabric lampshade. The new shade should span x=312 to x=712 and y=300 to y=540 on the 1024px square canvas. Preserve the lamp stem, tabletop, small wall details and lighting. Keep a believable shaded material and soft contact shadows.',
    visualRequirements: [
      'The wider shade has coherent fabric shading and contact with the original lamp stem.',
      'The original blue shade is completely removed.',
      'Texture, lighting and transitions are credible; protected details remain intact.',
    ],
  },
  {
    id: 'expanded-star',
    medium: 'graphic',
    prompt:
      'Replace only the blue circle with a flat orange (#f07820) eight-point compass star centered at (512,512). Its outer tips span 300 by 300 pixels, with an inner radius of 65 pixels. Preserve all other pixels, including the ATLAS lettering and border. Use crisp edges, no shadow and no glow.',
    visualRequirements: [
      'There are exactly eight sharp outer points and a balanced compass-star silhouette.',
      'The mark has a flat fill, with no glow, shadow, blue remnants or extra decoration.',
    ],
  },
  {
    id: 'diagram-label',
    medium: 'diagram',
    prompt:
      'In the diagram, change only the orange label DRAFT to READY, keeping the same sans-serif style, 76px font size, baseline y=542, and centered at x=512. Preserve the boxes, arrows, STEP A and STEP B labels, and white background. The output must remain 1024 by 1024.',
    visualRequirements: [
      'The replacement reads exactly READY and contains no additional characters.',
      'Typography, baseline and centering match the diagram; arrows and boxes remain intact.',
    ],
  },
  {
    id: 'transparent-cutout',
    medium: 'transparent',
    prompt:
      'Remove the solid blue 400px square behind the magenta ring, leaving the magenta ring untouched on a truly transparent background. Preserve its exact outer radius of 140px and inner radius of 80px centered at (512,512), the existing antialiased edges, and the 1024px square canvas. Do not paint a checkerboard.',
    visualRequirements: [
      'The ring is continuous and retains its smooth inner and outer edges.',
      'Removed background is real alpha transparency, without colored fringe or checkerboard pixels.',
    ],
  },
  {
    id: 'mixed-poster',
    medium: 'mixed',
    prompt:
      'Make two changes to this illustrated poster. Replace the mountain artwork inside the panel from (96,220) to (928,620) with a new softly painted purple mountain landscape. Keep its pale sky, layered peaks, grain and overall lighting; the mountains should occupy roughly the same silhouette and use rich violet and lighter purple brushwork. Also replace the blue circular badge with a precisely drawn orange (#f07820) ticket badge spanning x=692 to x=932 and y=692 to y=852, with centered semicircular notches of radius 18px on its left and right sides. Preserve the exact ATLAS and OPEN STUDIO lettering, the panel frame, the margins, and everything outside these two regions.',
    visualRequirements: [
      'The ticket has two centered semicircular side notches and balanced proportions.',
      'The mountain panel contains new purple painted artwork with credible grain and layered lighting.',
      'Existing lettering, panel boundaries and the surrounding layout remain unchanged.',
      'The new flat graphic belongs visually with the textured poster.',
    ],
  },
]

const rect = ({ left, top, width, height }: EvaluationBounds, fill: string) =>
  `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${fill}"/>`

async function png(body: string): Promise<Uint8Array> {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`))
    .png()
    .toBuffer()
}

async function protectedMask(regions: EvaluationBounds[]): Promise<Uint8Array> {
  const alpha = Buffer.alloc(size * size * 4, 255)
  for (const editable of regions) {
    for (let y = editable.top; y < editable.top + editable.height; y++) {
      for (let x = editable.left; x < editable.left + editable.width; x++) alpha[(y * size + x) * 4 + 3] = 0
    }
  }
  return sharp(alpha, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer()
}

function star(fill: string): string {
  const points = Array.from({ length: 16 }, (_, index) => {
    const angle = (index * Math.PI) / 8 - Math.PI / 2
    const radius = index % 2 === 0 ? 150 : 65
    return `${512 + Math.cos(angle) * radius},${512 + Math.sin(angle) * radius}`
  }).join(' ')
  return `<polygon fill="${fill}" points="${points}"/>`
}

function ring(fill: string): string {
  return `<path fill="${fill}" fill-rule="evenodd" d="M372 512a140 140 0 1 0 280 0a140 140 0 1 0 -280 0M432 512a80 80 0 1 0 160 0a80 80 0 1 0 -160 0"/>`
}

function ticket(fill: string): string {
  return `<path fill="${fill}" d="M692 692H932V754A18 18 0 0 0 932 790V852H692V790A18 18 0 0 0 692 754Z"/>`
}

function label(text: string, fill: string): string {
  return `<text x="512" y="542" text-anchor="middle" font-family="sans-serif" font-size="76" fill="${fill}">${text}</text>`
}

interface FixtureDrawing {
  background: string
  before: string
  after: string
  target: string
  editable: EvaluationBounds
  additionalEditable?: EvaluationBounds[]
  additionalTargets?: (Omit<EvaluationColorTarget, 'mask'> & { shape: string })[]
  color?: readonly [number, number, number]
  tolerance?: number
  minimumIntersectionOverUnion?: number
  transparent?: string
}

function drawing(id: string): FixtureDrawing {
  switch (id) {
    case 'shaded-object':
      return {
        background: `<defs><linearGradient id="wall"><stop stop-color="#bdc5ce"/><stop offset="1" stop-color="#e8dfce"/></linearGradient><linearGradient id="shade"><stop stop-color="#bc5319"/><stop offset=".45" stop-color="#f07820"/><stop offset="1" stop-color="#b84e17"/></linearGradient><filter id="texture"><feTurbulence baseFrequency=".8" numOctaves="2" seed="19" result="noise"/><feComposite in="noise" in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs><rect width="1024" height="1024" fill="url(#wall)"/><rect y="740" width="1024" height="284" fill="#a48c72"/><ellipse cx="512" cy="820" rx="180" ry="28" fill="#73695c" opacity=".35"/><path d="M504 440h16v360h-16Z" fill="#5a5450"/><ellipse cx="512" cy="800" rx="105" ry="12" fill="#716d67"/><rect x="100" y="140" width="88" height="88" fill="none" stroke="#626d73" stroke-width="5"/><path d="M116 184h56m-28-28v56" stroke="#626d73" stroke-width="3"/><circle cx="880" cy="640" r="12" fill="#5a6774"/>`,
        before: `<path d="M402 320H622L652 520H372Z" fill="${blue}"/>`,
        after: '<path d="M372 300H652L712 540H312Z" fill="url(#shade)" filter="url(#texture)"/>',
        target: '<path d="M372 300H652L712 540H312Z" fill="white"/>',
        editable: { left: 284, top: 276, width: 456, height: 290 },
        tolerance: 100,
        minimumIntersectionOverUnion: 0.72,
      }
    case 'expanded-star':
      return {
        background: `<rect width="1024" height="1024" fill="white"/><rect x="64" y="64" width="896" height="896" rx="8" fill="none" stroke="${ink}" stroke-width="4"/><text x="512" y="180" text-anchor="middle" font-family="sans-serif" font-size="54" fill="${ink}">ATLAS</text><path d="M184 844h656" stroke="${ink}" stroke-width="2"/>`,
        before: `<circle cx="512" cy="512" r="70" fill="${blue}"/>`,
        after: star(orange),
        target: star('white'),
        editable: { left: 332, top: 332, width: 360, height: 360 },
      }
    case 'diagram-label':
      return {
        background: `<rect width="1024" height="1024" fill="white"/><g fill="none" stroke="${ink}" stroke-width="4"><rect x="112" y="128" width="300" height="160" rx="18"/><rect x="612" y="736" width="300" height="160" rx="18"/><path d="M262 288V440H512M512 584V816H600M580 804l20 12-20 12"/></g><g text-anchor="middle" font-family="sans-serif" font-size="40" fill="${ink}"><text x="262" y="224">STEP A</text><text x="762" y="834">STEP B</text></g>`,
        before: label('DRAFT', orange),
        after: label('READY', orange),
        target: label('READY', 'white'),
        editable: { left: 296, top: 454, width: 432, height: 110 },
        minimumIntersectionOverUnion: 0.8,
      }
    case 'transparent-cutout':
      return {
        background: '',
        before: `${rect({ left: 312, top: 312, width: 400, height: 400 }, blue)}${ring(magenta)}`,
        after: ring(magenta),
        target: ring('white'),
        editable: { left: 308, top: 308, width: 408, height: 408 },
        color: [192, 64, 160],
        transparent: `<path fill="white" fill-rule="evenodd" d="M312 312H712V712H312ZM370 512a142 142 0 1 0 284 0a142 142 0 1 0 -284 0"/><circle cx="512" cy="512" r="78" fill="white"/>`,
      }
    case 'mixed-poster':
      return {
        background: `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#9bbdce"/><stop offset="1" stop-color="#ede5c6"/></linearGradient><filter id="paper"><feTurbulence baseFrequency=".3" numOctaves="2" seed="31" result="grain"/><feComposite in="grain" in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs><rect width="1024" height="1024" fill="#faf6e9"/><g font-family="sans-serif" text-anchor="middle" fill="${ink}"><text x="512" y="156" font-size="76">ATLAS</text><text x="512" y="940" font-size="48">OPEN STUDIO</text></g><g filter="url(#paper)"><rect x="96" y="220" width="832" height="400" fill="url(#sky)"/><path d="M96 620L286 332 424 526 612 292 928 620Z" fill="#506f70"/><path d="M170 620L372 400 516 568 740 388 928 620Z" fill="#76958b"/></g>`,
        before: `<circle cx="812" cy="772" r="60" fill="${blue}"/>`,
        after: `<g filter="url(#paper)"><rect x="96" y="220" width="832" height="400" fill="url(#sky)"/><path d="M96 620L286 332 424 526 612 292 928 620Z" fill="#7935ab"/><path d="M170 620L372 400 516 568 740 388 928 620Z" fill="#aa60bd"/></g>${ticket(orange)}`,
        target: ticket('white'),
        editable: { left: 668, top: 668, width: 288, height: 208 },
        additionalEditable: [{ left: 96, top: 220, width: 832, height: 400 }],
        additionalTargets: [
          {
            name: 'Purple artwork extent (not material realism)',
            bounds: { left: 96, top: 220, width: 832, height: 400 },
            color: [150, 74, 180],
            tolerance: 70,
            minimumIntersectionOverUnion: 0.7,
            maximumCenterError: 16,
            shape:
              '<path d="M96 620L286 332 424 526 612 292 928 620Z" fill="white"/><path d="M170 620L372 400 516 568 740 388 928 620Z" fill="white"/>',
          },
        ],
      }
    default:
      throw new Error(`Unknown image evaluation case: ${id}`)
  }
}

export async function createImageEvaluationFixture(id: string): Promise<ImageEvaluationFixture> {
  const definition = imageEvaluationCases.find((item) => item.id === id)
  if (!definition) throw new Error(`Unknown image evaluation case: ${id}`)
  const spec = drawing(id)
  const [source, example, mask, target, transparent] = await Promise.all([
    png(`${spec.background}${spec.before}`),
    png(`${spec.background}${spec.after}`),
    protectedMask([spec.editable, ...(spec.additionalEditable ?? [])]),
    png(spec.target),
    spec.transparent ? png(spec.transparent) : undefined,
  ])
  return {
    definition,
    width: size,
    height: size,
    source,
    example,
    protectedMask: mask,
    targets: [
      {
        name: id === 'diagram-label' ? 'Label template overlap (not OCR)' : 'Replacement color and footprint',
        bounds: spec.editable,
        color: spec.color ?? [240, 120, 32],
        tolerance: spec.tolerance ?? 24,
        mask: target,
        minimumIntersectionOverUnion: spec.minimumIntersectionOverUnion ?? 0.9,
        maximumCenterError: id === 'shaded-object' ? 12 : 5,
      },
      ...(await Promise.all(
        (spec.additionalTargets ?? []).map(async ({ shape, ...target }) => ({ ...target, mask: await png(shape) })),
      )),
    ],
    transparentTargets: transparent ? [{ name: 'Removed background and ring center', mask: transparent }] : [],
  }
}
