#if os(iOS)
import AVFoundation
import CoreMedia
import Foundation
@preconcurrency import ScreenCaptureKit

/// iOS 27 device-playback capture. The system picker owns consent and the
/// selected content filter; Audeeo only receives audio the system permits.
@available(iOS 27.0, *)
@MainActor
final class ScreenAudioCapture: NSObject {
    private let picker = SCContentSharingPicker.shared
    private let outputQueue = DispatchQueue(label: "com.mattdev727.audeeo.screen-audio")
    private var stream: SCStream?
    private var stopping = false

    var onAudio: ((Data) -> Void)?
    var onStarted: (() -> Void)?
    var onError: ((String) -> Void)?

    func presentPicker() {
        stopping = false
        var configuration = SCContentSharingPickerConfiguration()
        configuration.showsMicrophoneControl = false
        picker.defaultConfiguration = configuration
        if !picker.isActive {
            picker.add(self)
            picker.isActive = true
        }
        picker.present()
    }

    private func startCapture(with filter: SCContentFilter) async {
        await stopStream()
        guard !stopping else { return }

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 16_000
        configuration.channelCount = 1
        // A lightweight screen output keeps this a full-display capture while
        // Audeeo discards video frames and only uploads permitted playback audio.
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 1

        do {
            let next = SCStream(filter: filter, configuration: configuration, delegate: self)
            try next.addStreamOutput(self, type: .screen, sampleHandlerQueue: outputQueue)
            try next.addStreamOutput(self, type: .audio, sampleHandlerQueue: outputQueue)
            try await next.startCapture()
            guard !stopping else {
                try? await next.stopCapture()
                return
            }
            stream = next
            onStarted?()
        } catch {
            onError?("Device playback capture could not start: \(error.localizedDescription)")
        }
    }

    func stop() {
        guard !stopping else { return }
        stopping = true
        picker.isActive = false
        picker.remove(self)
        Task { @MainActor [weak self] in await self?.stopStream() }
    }

    private func stopStream() async {
        guard let active = stream else { return }
        stream = nil
        try? await active.stopCapture()
    }

    /// ScreenCaptureKit honors the requested 16 kHz mono format. Convert its
    /// linear PCM representation to the relay's signed little-endian PCM16.
    private nonisolated func pcm16(from sampleBuffer: CMSampleBuffer) -> Data? {
        guard sampleBuffer.isValid,
              let description = sampleBuffer.formatDescription,
              let formatPointer = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return nil }
        let format = formatPointer.pointee
        guard format.mFormatID == kAudioFormatLinearPCM,
              format.mSampleRate == 16_000,
              format.mChannelsPerFrame == 1 else { return nil }

        return try? sampleBuffer.withAudioBufferList(flags: .audioBufferListAssure16ByteAlignment) { buffers, _ in
            guard let buffer = buffers.first, let raw = buffer.mData else { return Data() }
            let byteCount = Int(buffer.mDataByteSize)
            let flags = format.mFormatFlags
            if (flags & kAudioFormatFlagIsFloat) != 0, format.mBitsPerChannel == 32 {
                let samples = raw.assumingMemoryBound(to: Float.self)
                let count = byteCount / MemoryLayout<Float>.stride
                var output = [Int16]()
                output.reserveCapacity(count)
                for index in 0..<count {
                    let normalized = max(-1, min(1, samples[index]))
                    output.append(Int16((normalized * 32_767).rounded()))
                }
                return output.withUnsafeBytes { Data($0) }
            }
            if (flags & kAudioFormatFlagIsSignedInteger) != 0, format.mBitsPerChannel == 16 {
                return Data(bytes: raw, count: byteCount)
            }
            return Data()
        }
    }
}

@available(iOS 27.0, *)
extension ScreenAudioCapture: SCContentSharingPickerObserver {
    nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        Task { @MainActor [weak self] in await self?.startCapture(with: filter) }
    }

    nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didCancelFor stream: SCStream?
    ) {
        Task { @MainActor [weak self] in
            guard let self, self.stream == nil, !self.stopping else { return }
            self.onError?("Device playback selection was canceled.")
        }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor [weak self] in
            self?.onError?("The device playback picker could not open: \(error.localizedDescription)")
        }
    }
}

@available(iOS 27.0, *)
extension ScreenAudioCapture: SCStreamOutput {
    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, let data = pcm16(from: sampleBuffer), !data.isEmpty else { return }
        Task { @MainActor [weak self] in self?.onAudio?(data) }
    }
}

@available(iOS 27.0, *)
extension ScreenAudioCapture: SCStreamDelegate {
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor [weak self] in
            guard let self, !self.stopping else { return }
            self.onError?("Device playback capture ended: \(error.localizedDescription)")
        }
    }
}
#endif
