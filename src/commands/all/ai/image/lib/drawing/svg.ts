import type { DrawingElement, DrawingScene, DrawingStyle } from './schema.ts'

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!
  })
}

function number(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000)
}

function points(values: Array<{ x: number; y: number }>): string {
  return values.map(({ x, y }) => `${number(x)},${number(y)}`).join(' ')
}

/** Generate alternating outer/inner vertices instead of asking a model to approximate them. */
export function starPoints(star: Extract<DrawingElement, { type: 'star' }>): Array<{ x: number; y: number }> {
  return Array.from({ length: star.points * 2 }, (_, index) => {
    const angle = (star.rotation * Math.PI) / 180 + (index * Math.PI) / star.points
    const radius = index % 2 === 0 ? star.outerRadius : star.innerRadius
    return { x: star.cx + Math.cos(angle) * radius, y: star.cy + Math.sin(angle) * radius }
  })
}

function coveragePaint(paint: string): string {
  if (paint === 'none') return paint
  return `#ffffff${paint.length === 9 ? paint.slice(7) : ''}`
}

function styleAttributes(style: DrawingStyle, coverage: boolean): string {
  const fill = coverage ? coveragePaint(style.fill) : style.fill
  const stroke = coverage ? coveragePaint(style.stroke) : style.stroke
  return `fill="${fill}" stroke="${stroke}" stroke-width="${number(style.strokeWidth)}" opacity="${number(style.opacity)}" stroke-linejoin="round" stroke-linecap="round"`
}

function pathData(path: Extract<DrawingElement, { type: 'path' }>): string {
  return path.commands
    .map((command) => {
      switch (command.command) {
        case 'move':
          return `M ${number(command.x)} ${number(command.y)}`
        case 'line':
          return `L ${number(command.x)} ${number(command.y)}`
        case 'cubic':
          return `C ${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)}`
        case 'quadratic':
          return `Q ${number(command.x1)} ${number(command.y1)} ${number(command.x)} ${number(command.y)}`
        case 'arc':
          return `A ${number(command.rx)} ${number(command.ry)} ${number(command.rotation)} ${Number(command.largeArc)} ${Number(command.clockwise)} ${number(command.x)} ${number(command.y)}`
        case 'close':
          return 'Z'
      }
    })
    .join(' ')
}

function elementSvg(element: DrawingElement, coverage: boolean): string {
  const style = styleAttributes(element.style, coverage)
  switch (element.type) {
    case 'rect':
      return `<rect x="${number(element.x)}" y="${number(element.y)}" width="${number(element.width)}" height="${number(element.height)}" rx="${number(element.radius)}" ${style}/>`
    case 'ellipse':
      return `<ellipse cx="${number(element.cx)}" cy="${number(element.cy)}" rx="${number(element.rx)}" ry="${number(element.ry)}" ${style}/>`
    case 'polygon':
      return `<polygon points="${points(element.points)}" ${style}/>`
    case 'star':
      return `<polygon points="${points(starPoints(element))}" ${style}/>`
    case 'line':
      return `<line x1="${number(element.x1)}" y1="${number(element.y1)}" x2="${number(element.x2)}" y2="${number(element.y2)}" ${style}/>`
    case 'path':
      return `<path d="${pathData(element)}" ${style}/>`
    case 'text': {
      const lines = element.text.split('\n')
      const contents = lines
        .map(
          (line, index) =>
            `<tspan x="${number(element.x)}" dy="${index === 0 ? 0 : number(element.fontSize * 1.2)}">${escapeXml(line)}</tspan>`,
        )
        .join('')
      return `<text x="${number(element.x)}" y="${number(element.y)}" font-family="${element.fontFamily}" font-size="${number(element.fontSize)}" font-weight="${element.fontWeight}" text-anchor="${element.anchor}" letter-spacing="${number(element.letterSpacing)}" transform="rotate(${number(element.rotation)} ${number(element.x)} ${number(element.y)})" xml:space="preserve" ${style}>${contents}</text>`
    }
  }
}

/** Only a normalized PNG provided by the caller may be embedded as image data. */
export function sceneSvg(scene: DrawingScene, options: { basePng?: Uint8Array; coverage?: boolean } = {}): string {
  const { width, height } = scene
  const coverage = options.coverage === true
  const background =
    scene.background === null
      ? ''
      : `<rect width="${width}" height="${height}" fill="${coverage ? coveragePaint(scene.background) : scene.background}"/>`
  const erase = scene.eraseRegions
    .map((region) => `<polygon points="${points(region.points)}" fill="${coverage ? '#ffffff' : '#000000'}"/>`)
    .join('')
  const mask =
    !coverage && erase
      ? `<defs><mask id="sky-base-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${erase}</mask></defs>`
      : ''
  const image =
    options.basePng && !coverage
      ? `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${Buffer.from(options.basePng).toString('base64')}"/>`
      : ''
  const base = image || background ? `<g${mask ? ' mask="url(#sky-base-mask)"' : ''}>${background}${image}</g>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${escapeXml(scene.description)}</title>${mask}${base}${coverage ? erase : ''}${scene.elements.map((element) => elementSvg(element, coverage)).join('')}</svg>`
}
