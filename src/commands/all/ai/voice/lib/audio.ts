/**
 * Raw PCM audio I/O for voice sessions.
 *
 * The Realtime API speaks 16-bit mono PCM at 24kHz in both directions. A
 * Bun process has no audio-device access of its own, so two engines are
 * available:
 *
 * - DuplexAudio (preferred): one Swift helper running both directions
 *   through a voice-processed AVAudioEngine, so macOS cancels the
 *   assistant's own speech out of the microphone feed — open speakers
 *   work and barge-in stays real. Compiled once from audioHelper.swift
 *   and cached under ~/.sky/cache.
 *
 * - MicCapture + SpeakerPlayer (fallback): raw ffmpeg avfoundation in,
 *   audiotoolbox out. No echo cancellation — the session mutes the mic
 *   while the assistant speaks to avoid self-interruption.
 */

import { Buffer } from 'node:buffer'
import { mkdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_HOME } from '#config'

export const PCM_SAMPLE_RATE = 24_000
/** 16-bit mono: two bytes per sample. */
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2

/** Duration of a PCM16 mono 24kHz byte span. */
export function pcmMs(bytes: number): number {
  return (bytes / PCM_BYTES_PER_SECOND) * 1000
}

/**
 * Where playback stands, given bytes handed to the player and wall-clock
 * elapsed since the utterance began. Playback is real-time, so position is
 * elapsed time clamped to what was actually sent; once elapsed passes the
 * sent duration the utterance has finished draining.
 */
export function playbackPosition(sentBytes: number, elapsedMs: number): { playedMs: number; stillPlaying: boolean } {
  const sentMs = pcmMs(sentBytes)
  return { playedMs: Math.min(Math.max(elapsedMs, 0), sentMs), stillPlaying: elapsedMs >= 0 && elapsedMs < sentMs }
}

/** Child exit codes that mean "shut down on purpose", not "broke". */
export function isExpectedExit(code: number | null): boolean {
  return code === null || code === 0 || code === 130 || code === 143
}

/** Snapshot of the utterance that was sounding when an interrupt landed. */
export interface InterruptSnapshot {
  itemId: string
  playedMs: number
  stillPlaying: boolean
}

/** Per-utterance playback bookkeeping shared by both engines. */
class PlaybackTracker {
  private itemId: string | null = null
  private sentBytes = 0
  private startedAt = 0

  note(bytes: number, itemId: string): void {
    if (this.itemId !== itemId) {
      this.itemId = itemId
      this.sentBytes = 0
      this.startedAt = performance.now()
    }
    this.sentBytes += bytes
  }

  /** True while the current utterance (plus a short tail) is still audible. */
  isActive(tailMs = 0): boolean {
    if (!this.itemId) return false
    return performance.now() - this.startedAt < pcmMs(this.sentBytes) + tailMs
  }

  snapshotAndReset(): InterruptSnapshot | null {
    const snapshot = this.itemId
      ? { itemId: this.itemId, ...playbackPosition(this.sentBytes, performance.now() - this.startedAt) }
      : null
    this.itemId = null
    this.sentBytes = 0
    return snapshot
  }
}

/** What a session needs from an audio engine, whichever one is running. */
export interface AudioEngine {
  /** No echo cancellation — the session must mute the mic while speaking. */
  readonly echoProne: boolean
  /** Total PCM bytes captured — zero after several seconds means a device/permission problem. */
  readonly bytesRead: number
  /** Loudest |int16| sample captured so far — bytes flowing with no level means a silent-path bug. */
  readonly peakLevel: number
  start(): void
  playbackWrite(deltaBase64: string, itemId: string): void
  /** True while assistant audio (plus tail) is still sounding. */
  playbackActive(tailMs?: number): boolean
  /** Barge-in: silence playback now; report where the utterance stood. */
  playbackInterrupt(): InterruptSnapshot | null
  stop(): void
}

export interface EngineCallbacks {
  /** Base64-encoded PCM16 chunk, ready for input_audio_buffer.append. */
  onChunk: (base64: string) => void
  /** The audio child exited — code plus whatever it wrote to stderr (capped). */
  onExit?: (code: number | null, stderr: string) => void
}

// -----------------------------------------------------------------------------
// Preferred engine: the voice-processed Swift helper
// -----------------------------------------------------------------------------

const HELPER_SOURCE = new URL('./audioHelper.swift', import.meta.url).pathname
const HELPER_BINARY = path.join(DIR_HOME, '.sky', 'cache', 'sky-voice-audio')

/**
 * Compile the Swift helper if the cached binary is missing or older than
 * its source, then preflight it once. Returns the binary path, or null
 * when it cannot be built or cannot initialize audio (no swiftc, no mic
 * permission, exotic device setups) — callers fall back to the ffmpeg
 * engine before the session ever connects.
 */
export async function ensureAudioHelper(onStatus?: (line: string) => void): Promise<string | null> {
  const probe = Bun.spawnSync(['xcrun', '--find', 'swiftc'], { stdout: 'ignore', stderr: 'ignore' })
  if (probe.exitCode !== 0) return null

  const sourceStat = await stat(HELPER_SOURCE)
  const binaryStat = await stat(HELPER_BINARY).catch(() => null)
  if (!binaryStat || binaryStat.mtimeMs < sourceStat.mtimeMs) {
    onStatus?.('Compiling the echo-cancelling audio helper (one-time)...')
    await mkdir(path.dirname(HELPER_BINARY), { recursive: true })
    const build = Bun.spawnSync(['xcrun', 'swiftc', '-O', '-swift-version', '5', '-o', HELPER_BINARY, HELPER_SOURCE], {
      stdout: 'ignore',
      stderr: 'pipe',
    })
    if (build.exitCode !== 0) {
      onStatus?.(`Audio helper build failed: ${build.stderr.toString().slice(0, 400)}`)
      return null
    }
  }

  // Preflight: with stdin at /dev/null the helper starts its audio engine,
  // reads instant EOF, and exits 0. A non-zero exit means it cannot run
  // here (mic permission, device quirks) — better to learn that now than
  // mid-session with a dead microphone.
  const preflight = Bun.spawnSync([HELPER_BINARY], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', timeout: 5000 })
  if (preflight.exitCode !== 0) {
    const detail = preflight.stderr.toString().split('\n')[0] ?? ''
    onStatus?.(`Echo-cancelled engine unavailable (${detail.trim() || 'preflight failed'})`)
    return null
  }
  return HELPER_BINARY
}

/**
 * Both audio directions through the voice-processed helper process.
 *
 * Playback rides a length-framed stdin protocol — 4-byte little-endian
 * payload length, then the PCM bytes; a zero-length frame flushes the
 * helper's playback queue (barge-in). Framing instead of signals: Bun
 * maps signal names to Linux numbers, so kill('SIGUSR1') delivered
 * macOS's SIGBUS and killed the helper on the first interrupt.
 */
export class DuplexAudio implements AudioEngine {
  readonly echoProne = false
  bytesRead = 0
  peakLevel = 0
  private readonly tracker = new PlaybackTracker()
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private stopped = false

  constructor(
    private readonly binaryPath: string,
    private readonly callbacks: EngineCallbacks,
  ) {}

  start(): void {
    if (this.proc) return
    const proc = Bun.spawn([this.binaryPath], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    this.proc = proc
    void pumpChunks(proc.stdout as ReadableStream<Uint8Array>, (chunk) => {
      if (this.stopped) return
      this.bytesRead += chunk.byteLength
      this.peakLevel = scanPeak(chunk, this.peakLevel)
      this.callbacks.onChunk(Buffer.from(chunk).toString('base64'))
    })
    void watchExit(proc, () => this.stopped, this.callbacks.onExit)
  }

  playbackWrite(deltaBase64: string, itemId: string): void {
    if (!this.proc || this.stopped) return
    const bytes = new Uint8Array(Buffer.from(deltaBase64, 'base64'))
    this.writeFrame(bytes)
    this.tracker.note(bytes.byteLength, itemId)
  }

  playbackActive(tailMs = 0): boolean {
    return this.tracker.isActive(tailMs)
  }

  playbackInterrupt(): InterruptSnapshot | null {
    // A zero-length frame tells the helper to drop everything it has
    // queued — the process (and the microphone) keep running.
    if (this.proc && !this.stopped) this.writeFrame(null)
    return this.tracker.snapshotAndReset()
  }

  /** Frame = 4-byte LE payload length + payload; null payload = flush command. */
  private writeFrame(payload: Uint8Array | null): void {
    if (!this.proc) return
    const stdin = this.proc.stdin as { write: (b: Uint8Array) => unknown; flush: () => void }
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, payload?.byteLength ?? 0, true)
    stdin.write(header)
    if (payload && payload.byteLength > 0) stdin.write(payload)
    stdin.flush()
  }

  stop(): void {
    this.stopped = true
    const stdin = this.proc?.stdin as { end: () => void } | undefined
    try {
      stdin?.end() // EOF is the helper's clean-exit signal
    } catch {
      // already gone
    }
    this.proc?.kill()
    this.proc = null
  }
}

// -----------------------------------------------------------------------------
// Fallback engine: raw ffmpeg capture + playback
// -----------------------------------------------------------------------------

/** Capture and playback as two ffmpeg children — no echo cancellation. */
export class FfmpegAudio implements AudioEngine {
  readonly echoProne = true
  private readonly mic: MicCapture
  private readonly player = new SpeakerPlayer()

  constructor(device: string, callbacks: EngineCallbacks) {
    this.mic = new MicCapture({ device, ...callbacks })
  }

  get bytesRead(): number {
    return this.mic.bytesRead
  }

  get peakLevel(): number {
    return this.mic.peakLevel
  }

  start(): void {
    this.mic.start()
  }

  playbackWrite(deltaBase64: string, itemId: string): void {
    this.player.write(deltaBase64, itemId)
  }

  playbackActive(tailMs = 0): boolean {
    return this.player.isActive(tailMs)
  }

  playbackInterrupt(): InterruptSnapshot | null {
    return this.player.interrupt()
  }

  stop(): void {
    this.mic.stop()
    this.player.stop()
  }
}

export interface MicCaptureOptions extends EngineCallbacks {
  /** avfoundation audio device index or name (`ffmpeg -f avfoundation -list_devices true -i ""`). */
  device: string
}

export class MicCapture {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private stopped = false
  bytesRead = 0
  peakLevel = 0

  constructor(private readonly opts: MicCaptureOptions) {}

  start(): void {
    if (this.proc) return
    const proc = Bun.spawn(
      [
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'avfoundation',
        '-i',
        `:${this.opts.device}`,
        '-ar',
        String(PCM_SAMPLE_RATE),
        '-ac',
        '1',
        '-f',
        's16le',
        '-',
      ],
      { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
    )
    this.proc = proc
    void pumpChunks(proc.stdout as ReadableStream<Uint8Array>, (chunk) => {
      if (this.stopped) return
      this.bytesRead += chunk.byteLength
      this.peakLevel = scanPeak(chunk, this.peakLevel)
      this.opts.onChunk(Buffer.from(chunk).toString('base64'))
    })
    void watchExit(proc, () => this.stopped, this.opts.onExit)
  }

  stop(): void {
    this.stopped = true
    this.proc?.kill()
    this.proc = null
  }
}

/**
 * Streams PCM16 deltas to the speakers. One long-lived ffmpeg process
 * plays everything; barge-in kills it (dropping whatever audio it still
 * buffered) and the next utterance lazily respawns it.
 */
export class SpeakerPlayer {
  private readonly tracker = new PlaybackTracker()
  private proc: ReturnType<typeof Bun.spawn> | null = null

  write(deltaBase64: string, itemId: string): void {
    const bytes = new Uint8Array(Buffer.from(deltaBase64, 'base64'))
    const proc = this.ensureProc()
    const stdin = proc.stdin as { write: (b: Uint8Array) => unknown; flush: () => void }
    stdin.write(bytes)
    // Without an explicit flush Bun batches small writes and the audio
    // arrives in bursts — audibly choppy playback.
    stdin.flush()
    this.tracker.note(bytes.byteLength, itemId)
  }

  isActive(tailMs = 0): boolean {
    return this.tracker.isActive(tailMs)
  }

  interrupt(): InterruptSnapshot | null {
    this.killProc()
    return this.tracker.snapshotAndReset()
  }

  stop(): void {
    this.killProc()
    this.tracker.snapshotAndReset()
  }

  private ensureProc(): ReturnType<typeof Bun.spawn> {
    if (this.proc) return this.proc
    this.proc = Bun.spawn(
      [
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        // Raw PCM needs no probing; skipping it trims startup latency.
        '-probesize',
        '32',
        '-analyzeduration',
        '0',
        '-f',
        's16le',
        '-ar',
        String(PCM_SAMPLE_RATE),
        '-ac',
        '1',
        '-i',
        '-',
        '-f',
        'audiotoolbox',
        'default',
      ],
      { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' },
    )
    return this.proc
  }

  private killProc(): void {
    this.proc?.kill()
    this.proc = null
  }
}

// -----------------------------------------------------------------------------
// Shared child-process plumbing
// -----------------------------------------------------------------------------

/**
 * Loudest |int16| in a little-endian PCM chunk, sampled every 4th frame —
 * plenty to tell silence from signal without touching every byte.
 */
export function scanPeak(chunk: Uint8Array, current: number): number {
  let peak = current
  for (let i = 0; i + 1 < chunk.length; i += 8) {
    const raw = chunk[i] | (chunk[i + 1] << 8)
    const value = raw >= 0x8000 ? 0x10000 - raw : raw
    if (value > peak) peak = value
  }
  return peak
}

async function pumpChunks(stdout: ReadableStream<Uint8Array>, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  const reader = stdout.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      onChunk(value)
    }
  } catch {
    // Stream torn down mid-read on stop() — expected.
  }
}

async function watchExit(
  proc: ReturnType<typeof Bun.spawn>,
  isStopped: () => boolean,
  onExit?: (code: number | null, stderr: string) => void,
): Promise<void> {
  let stderr = ''
  try {
    stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text()
  } catch {
    // stderr already closed — nothing to collect
  }
  const code = await proc.exited
  if (!isStopped()) onExit?.(code, stderr.slice(0, 2000))
}
