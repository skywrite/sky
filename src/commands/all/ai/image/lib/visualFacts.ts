import sharp from 'sharp'

export interface ImageVisualFacts {
  width: number
  height: number
  transparentPixels: number
  fractionalAlphaPixels: number
  opaquePixels: number
}

/** Inspect actual image pixels; a model preview background cannot establish whether alpha is present. */
export async function imageVisualFacts(data: Uint8Array): Promise<ImageVisualFacts> {
  const { data: alpha, info } = await sharp(data)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .timeout({ seconds: 30 })
    .toBuffer({ resolveWithObject: true })
  const facts: ImageVisualFacts = {
    width: info.width,
    height: info.height,
    transparentPixels: 0,
    fractionalAlphaPixels: 0,
    opaquePixels: 0,
  }
  for (const value of alpha) {
    if (value === 0) facts.transparentPixels++
    else if (value === 255) facts.opaquePixels++
    else facts.fractionalAlphaPixels++
  }
  return facts
}
