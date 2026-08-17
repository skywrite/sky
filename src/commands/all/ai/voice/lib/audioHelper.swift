// Full-duplex voice-processed audio for ai:voice.
//
// One AVAudioEngine carries both directions so macOS's voice-processing
// unit (the echo canceller behind FaceTime/Safari) has the exact playback
// reference signal — the microphone feed comes back with the assistant's
// own speech removed, which is what makes open-speaker use viable.
//
// Two hard-won constraints on this wiring (macOS 26, empirically):
// - The player must connect DIRECTLY to outputNode at the hardware-ish
//   48kHz stereo format. Routing through mainMixerNode after enabling
//   voice processing fails kAUInitialize (-10875).
// - Input and output devices should run the same nominal sample rate;
//   mismatched rates are a classic VPIO init failure, so they are
//   aligned up front (idempotent when already equal).
//
// Protocol:
//   stdin  → speakers, as length-framed PCM16 mono 24kHz: each frame is a
//            4-byte little-endian payload length followed by that many
//            bytes. A ZERO-length frame means "drop all queued playback
//            immediately" (barge-in). Framing instead of signals: signal
//            numbers differ per platform and the parent runtime delivered
//            Linux's SIGUSR1 (10) — macOS's SIGBUS — killing the helper.
//   stdout ← microphone (echo-cancelled), raw PCM16 mono 24kHz
//   stdin EOF: clean exit
// Diagnostics go to stderr only.

import AVFoundation
import CoreAudio
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(("audioHelper: " + message + "\n").utf8))
  exit(2)
}

// -----------------------------------------------------------------------------
// Device sample-rate alignment
// -----------------------------------------------------------------------------

func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioDeviceID {
  var addr = AudioObjectPropertyAddress(
    mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var dev = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev)
  return dev
}

func nominalRate(_ dev: AudioDeviceID) -> Float64 {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var rate = Float64(0)
  var size = UInt32(MemoryLayout<Float64>.size)
  AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &rate)
  return rate
}

func setNominalRate(_ dev: AudioDeviceID, _ rate: Float64) -> Bool {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var value = rate
  if AudioObjectSetPropertyData(dev, &addr, 0, nil, UInt32(MemoryLayout<Float64>.size), &value) != noErr {
    return false
  }
  for _ in 0..<40 { // device reconfigure is async — poll up to 2s
    if nominalRate(dev) == rate { return true }
    usleep(50_000)
  }
  return nominalRate(dev) == rate
}

let inputDevice = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
let outputDevice = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
let inputRate = nominalRate(inputDevice)
let outputRate = nominalRate(outputDevice)
if inputRate != outputRate, inputRate > 0, outputRate > 0 {
  if !(setNominalRate(outputDevice, inputRate) || setNominalRate(inputDevice, outputRate)) {
    FileHandle.standardError.write(
      Data("audioHelper: could not align device sample rates (\(inputRate) vs \(outputRate))\n".utf8))
  }
}

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

let engine = AVAudioEngine()
let playerNode = AVAudioPlayerNode()

do {
  try engine.inputNode.setVoiceProcessingEnabled(true)
  try? engine.outputNode.setVoiceProcessingEnabled(true)
} catch {
  fail("voice processing unavailable: \(error)")
}

guard
  let playInFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true),
  let playOutFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false),
  let playConverter = AVAudioConverter(from: playInFormat, to: playOutFormat)
else { fail("could not build playback formats") }
engine.attach(playerNode)
engine.connect(playerNode, to: engine.outputNode, format: playOutFormat)

// The voice-processed input reports many identical channels (nine on
// this hardware). AVAudioConverter's implicit multichannel→mono mixdown
// yields PURE SILENCE (measured: every raw channel carried signal, the
// mixdown output peaked at zero), so channel 0 is extracted by hand and
// the converter only ever does mono→mono sample-rate work.
let micFormat = engine.inputNode.outputFormat(forBus: 0)
guard
  let monoFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: micFormat.sampleRate, channels: 1, interleaved: false),
  let captureFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true),
  let micConverter = AVAudioConverter(from: monoFormat, to: captureFormat)
else { fail("could not build capture formats") }

let stdout = FileHandle.standardOutput
engine.inputNode.installTap(onBus: 0, bufferSize: 2048, format: micFormat) { buffer, _ in
  let frames = Int(buffer.frameLength)
  guard frames > 0, let channels = buffer.floatChannelData else { return }
  guard let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: AVAudioFrameCount(frames)) else { return }
  mono.frameLength = AVAudioFrameCount(frames)
  mono.floatChannelData![0].update(from: channels[0], count: frames)

  let ratio = captureFormat.sampleRate / monoFormat.sampleRate
  let capacity = AVAudioFrameCount(Double(frames) * ratio) + 32
  guard let converted = AVAudioPCMBuffer(pcmFormat: captureFormat, frameCapacity: capacity) else { return }
  var gaveInput = false
  var conversionError: NSError?
  micConverter.convert(to: converted, error: &conversionError) { _, outStatus in
    if gaveInput {
      outStatus.pointee = .noDataNow
      return nil
    }
    gaveInput = true
    outStatus.pointee = .haveData
    return mono
  }
  if conversionError != nil || converted.frameLength == 0 { return }
  guard let channel = converted.int16ChannelData else { return }
  stdout.write(Data(bytes: channel[0], count: Int(converted.frameLength) * 2))
}

do {
  try engine.start()
} catch {
  fail("engine start failed (microphone permission?): \(error)")
}
playerNode.play()

// -----------------------------------------------------------------------------
// Playback: stdin PCM16 mono 24k → 48k stereo float → player
// All scheduling and barge-in resets happen on the main queue, so the
// converter's streaming state can never race an interrupt.
// -----------------------------------------------------------------------------

func schedulePlayback(_ raw: Data) {
  let frames = raw.count / 2
  if frames == 0 { return }
  guard let inBuffer = AVAudioPCMBuffer(pcmFormat: playInFormat, frameCapacity: AVAudioFrameCount(frames)) else {
    return
  }
  inBuffer.frameLength = AVAudioFrameCount(frames)
  raw.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
    inBuffer.int16ChannelData![0].update(from: bytes.bindMemory(to: Int16.self).baseAddress!, count: frames)
  }
  let capacity = AVAudioFrameCount(Double(frames) * playOutFormat.sampleRate / playInFormat.sampleRate) + 64
  guard let outBuffer = AVAudioPCMBuffer(pcmFormat: playOutFormat, frameCapacity: capacity) else { return }
  var gaveInput = false
  var conversionError: NSError?
  playConverter.convert(to: outBuffer, error: &conversionError) { _, outStatus in
    if gaveInput {
      outStatus.pointee = .noDataNow
      return nil
    }
    gaveInput = true
    outStatus.pointee = .haveData
    return inBuffer
  }
  if conversionError != nil || outBuffer.frameLength == 0 { return }
  playerNode.scheduleBuffer(outBuffer, completionHandler: nil)
}

// Barge-in: drop everything scheduled and the converter's buffered tail,
// then re-arm for future buffers.
func flushPlayback() {
  playerNode.stop()
  playConverter.reset()
  playerNode.play()
}

/// Corruption guard: no real audio delta is anywhere near this large.
let maxFrameBytes = 16 * 1024 * 1024

// stdin reader: accumulate bytes, peel off complete frames.
DispatchQueue.global(qos: .userInteractive).async {
  let stdin = FileHandle.standardInput
  var pending = Data()
  while true {
    let data = stdin.availableData
    if data.isEmpty { exit(0) } // parent closed our stdin — session over
    pending.append(data)
    while pending.count >= 4 {
      let length = pending.withUnsafeBytes { raw in
        UInt32(littleEndian: raw.loadUnaligned(as: UInt32.self))
      }
      if length == 0 {
        pending.removeSubrange(0..<4)
        DispatchQueue.main.async { flushPlayback() }
        continue
      }
      if length > maxFrameBytes { fail("frame length \(length) — stream corrupt") }
      let total = 4 + Int(length)
      if pending.count < total { break }
      let payload = pending.subdata(in: 4..<total)
      pending.removeSubrange(0..<total)
      DispatchQueue.main.async { schedulePlayback(payload) }
    }
  }
}

RunLoop.main.run()
