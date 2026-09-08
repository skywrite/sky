import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js'
import { Break, Fn, If, color, exp, float, max, mix, sin, smoothstep, texture3D, uniform, vec3, vec4 } from 'three/tsl'
import {
  BackSide,
  BoxGeometry,
  Data3DTexture,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  PerspectiveCamera,
  RedFormat,
  RepeatWrapping,
  Scene,
  WebGPURenderer,
  type Node,
} from 'three/webgpu'
import type { Speaker } from './voiceController.ts'

export interface VoiceCloud {
  update(level: number, seconds: number, reducedMotion: boolean, listening: boolean): number
  dispose(): void
}

let noiseData: Uint8Array<ArrayBuffer> | undefined

/** Tileable density data is shared on the CPU; each renderer owns its GPU texture. */
function createNoiseTexture(): Data3DTexture {
  const size = 48
  if (!noiseData) {
    noiseData = new Uint8Array(size ** 3)
    const hash = (x: number, y: number, z: number, period: number) => {
      const n = Math.sin((x % period) * 127.1 + (y % period) * 311.7 + (z % period) * 74.7) * 43758.5453
      return n - Math.floor(n)
    }
    const fade = (t: number) => t * t * (3 - 2 * t)
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const value = (x: number, y: number, z: number, period: number) => {
      const ix = Math.floor(x),
        iy = Math.floor(y),
        iz = Math.floor(z)
      const fx = fade(x - ix),
        fy = fade(y - iy),
        fz = fade(z - iz)
      const plane = (dz: number) =>
        lerp(
          lerp(hash(ix, iy, iz + dz, period), hash(ix + 1, iy, iz + dz, period), fx),
          lerp(hash(ix, iy + 1, iz + dz, period), hash(ix + 1, iy + 1, iz + dz, period), fx),
          fy,
        )
      return lerp(plane(0), plane(1), fz)
    }
    let index = 0
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          let noise = 0
          for (const [frequency, amplitude] of [
            [3, 0.52],
            [6, 0.27],
            [12, 0.14],
            [24, 0.07],
          ]) {
            noise +=
              value((x / size) * frequency, (y / size) * frequency, (z / size) * frequency, frequency) * amplitude
          }
          noiseData[index++] = Math.round(noise * 255)
        }
  }
  const texture = new Data3DTexture(noiseData, size, size, size)
  texture.format = RedFormat
  texture.minFilter = texture.magFilter = LinearFilter
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

/** Sky's circle and Sonny's triangle contain drifting wisps with matching audio motion. */
export async function createVoiceCloud(canvas: HTMLCanvasElement, speaker: Speaker): Promise<VoiceCloud> {
  const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setClearColor(0xffffff, 0)
  renderer.toneMapping = NoToneMapping
  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 10)
  camera.position.set(0, 0, 4.6)
  const clock = uniform(speaker === 'sky' ? 0 : 3.7)
  const energy = uniform(0)
  const attention = uniform(0)
  const volume = createNoiseTexture()
  const noise = texture3D(volume, null, 0)
  const upperColor = color(speaker === 'sky' ? '#758ef4' : '#ffa448')
  const lowerColor = color(speaker === 'sky' ? '#afcfff' : '#ffc1a9')
  const white = color(speaker === 'sky' ? '#f7fbff' : '#fff8e9')
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide,
    toneMapped: false,
  })
  const cloud = Fn(() => {
    const result = vec4(0).toVar()
    RaymarchingBox(68, ({ positionRay }: { positionRay: Node<'vec3'> }) => {
      const p = positionRay.mul(2.8).toVar()
      const triangleY = p.y.add(0.295)
      const contour =
        speaker === 'sky'
          ? p.div(vec3(0.93, 0.93, 0.77)).length()
          : max(max(p.x.abs().mul(Math.sqrt(3)).add(triangleY), triangleY.mul(-2)).div(1.18), p.z.abs().div(0.68))
      const edge = smoothstep(0.99, 1.012, contour).oneMinus()
      If(edge.greaterThan(0.001), () => {
        const drift = vec3(clock.mul(0.022), clock.mul(-0.014), clock.mul(0.011))
        const broad = noise.sample(p.mul(0.56).add(0.5).add(drift)).r.toVar()
        const curl = sin(p.x.mul(2.4).add(clock.mul(0.17)))
          .mul(0.16)
          .add(sin(p.z.mul(3.1).sub(clock.mul(0.11))).mul(0.13))
        const flowing = p.add(vec3(broad.mul(0.21), curl.add(broad.sub(0.5).mul(0.38)), broad.mul(0.16)))
        const fine = noise.sample(flowing.mul(1.8).add(0.17).sub(drift.mul(0.7))).r
        const filaments = noise.sample(
          flowing
            .mul(vec3(3.7, 5.2, 3.7))
            .add(0.31)
            .sub(drift),
        ).r
        const band = smoothstep(0.15, 0.69, p.y.add(curl).add(broad.sub(0.5).mul(0.7)).abs()).oneMinus()
        const wisps = smoothstep(
          0.47,
          0.74,
          broad.mul(0.48).add(fine.mul(0.34)).add(filaments.mul(0.18)).add(band.mul(0.14)),
        )
        const gradient = smoothstep(-0.75, 0.75, p.y)
        const tint = mix(lowerColor, upperColor, gradient)
        const depth = smoothstep(-0.8, 0.6, p.z).mul(0.14).add(0.86)
        const illumination = wisps.mul(0.92).add(energy.mul(0.04)).add(attention.mul(0.025)).clamp()
        const shade = mix(tint.mul(depth), white, illumination)
        const density = edge.mul(float(0.18).add(wisps.mul(0.3)))
        const alpha = exp(density.negate()).oneMinus()
        const contribution = result.a.oneMinus().mul(alpha)
        result.rgb.addAssign(shade.mul(contribution))
        result.a.addAssign(contribution)
      })
      If(result.a.greaterThan(0.995), () => {
        Break()
      })
    })
    return vec4(result.rgb.div(max(result.a, 0.0001)), result.a)
  })()
  material.colorNode = cloud.rgb
  material.opacityNode = cloud.a
  const geometry = new BoxGeometry(1, 1, 1)
  const form = new Mesh(geometry, material)
  form.scale.setScalar(2.8)
  scene.add(form)
  let disposed = false
  let lastTime: number | undefined
  let flow = clock.value
  let strength = 0
  const resize = () => {
    if (disposed) return
    const { width, height } = canvas.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.position.z = Math.max(4.6, 4.6 / camera.aspect)
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  const dispose = () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    geometry.dispose()
    material.dispose()
    volume.dispose()
    scene.clear()
    renderer.dispose()
    delete canvas.dataset.renderer
  }
  try {
    await renderer.init()
    canvas.dataset.renderer = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? 'WebGPU'
      : 'WebGL2'
    observer.observe(canvas)
    resize()
    await renderer.compileAsync(scene, camera)
    renderer.render(scene, camera)
  } catch (error) {
    dispose()
    throw error
  }
  return {
    update(level, seconds, reducedMotion, listening) {
      if (disposed) return 0
      const elapsed = lastTime === undefined ? 1 / 60 : Math.max(0, Math.min(0.05, seconds - lastTime))
      lastTime = seconds
      const target = Math.max(0, Math.min(1, level))
      strength += (target - strength) * (1 - Math.exp(-elapsed * (target > strength ? 14 : 9)))
      if (strength < 0.001) strength = 0
      energy.value = strength
      attention.value += ((listening ? 1 : 0) - attention.value) * (1 - Math.exp(-elapsed * 3))
      if (!reducedMotion) flow += elapsed * (0.75 + strength * 2.8 - attention.value * 0.15)
      clock.value = flow
      form.position.y = reducedMotion ? 0 : Math.sin(flow * 0.55) * 0.025
      const breath = reducedMotion ? 0 : Math.sin(flow * 0.7) * 0.009
      const pulse = reducedMotion ? 0 : strength * 0.055
      form.scale.setScalar(2.8 * (1 + breath + pulse))
      renderer.render(scene, camera)
      return strength
    },
    dispose,
  }
}
