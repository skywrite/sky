import type { DrawingElement, DrawingScene, DrawingStyle } from './schema.ts'

export const solidStyle: DrawingStyle = { fill: '#ff8000', stroke: 'none', strokeWidth: 0, opacity: 1 }

export function drawingScene(elements: DrawingElement[] = []): DrawingScene {
  return {
    width: 128,
    height: 96,
    description: 'A synthetic design for Atlas.',
    requirements: ['Preserve the requested placement and colors.'],
    background: null,
    eraseRegions: [],
    elements,
  }
}

export function drawingStar(
  overrides: Partial<Extract<DrawingElement, { type: 'star' }>> = {},
): Extract<DrawingElement, { type: 'star' }> {
  return {
    type: 'star',
    cx: 64,
    cy: 48,
    outerRadius: 40,
    innerRadius: 18,
    points: 8,
    rotation: -90,
    style: solidStyle,
    ...overrides,
  }
}
