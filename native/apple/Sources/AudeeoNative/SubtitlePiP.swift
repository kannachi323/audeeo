#if os(iOS)
import AVKit
import UIKit
import CoreMedia

@available(iOS 15.0, *)
public final class SubtitlePiP: NSObject, AVPictureInPictureSampleBufferPlaybackDelegate, AVPictureInPictureControllerDelegate {
    public let layer = AVSampleBufferDisplayLayer()
    private var controller: AVPictureInPictureController?
    private var source = "Ready to listen"
    private var translation = ""
    public var captionSize: CGFloat = 24 { didSet { render() } }
    private var timer: Timer?
    public var onError: ((String) -> Void)?
    public override init() {
        super.init()
        layer.videoGravity = .resizeAspect
        let content = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: layer, playbackDelegate: self)
        controller = AVPictureInPictureController(contentSource: content)
        controller?.delegate = self
        controller?.canStartPictureInPictureAutomaticallyFromInline = false
    }
    public func attach(to view: UIView) {
        layer.frame = CGRect(x: 16, y: max(0, view.bounds.height - 180), width: max(280, view.bounds.width - 32), height: 150)
        view.layer.addSublayer(layer)
        render()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.render() }
    }
    public func update(source: String, translation: String) { self.source = source; self.translation = translation; render() }
    public func start() throws {
        guard AVPictureInPictureController.isPictureInPictureSupported(), controller?.isPictureInPicturePossible == true else {
            throw NSError(domain: "Audeeo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Picture in Picture is not available yet. Start captions and retry on a supported device."])
        }
        controller?.startPictureInPicture()
    }
    public func stop() { controller?.stopPictureInPicture(); timer?.invalidate(); timer = nil; layer.removeFromSuperlayer() }
    private func render() {
        let width = 960, height = 360
        var pixel: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32ARGB,
            [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &pixel) == kCVReturnSuccess, let pixel else { return }
        CVPixelBufferLockBaseAddress(pixel, [])
        defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
        guard let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return }
        context.setFillColor(UIColor(white: 0.075, alpha: 1).cgColor); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.translateBy(x: 0, y: CGFloat(height)); context.scaleBy(x: 1, y: -1)
        UIGraphicsPushContext(context)
        let bilingual = !source.isEmpty && !translation.isEmpty
        func drawCaption(_ value: String, fontSize: CGFloat, y: CGFloat, color: UIColor) {
            guard !value.isEmpty else { return }
            let font = UIFont.systemFont(ofSize: fontSize * max(18, min(40, captionSize)) / 24)
            let lines = bilingual ? 1 : 2
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byCharWrapping
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
            let limit = ceil(font.lineHeight) * CGFloat(lines)
            let chars = Array(value.replacingOccurrences(of: "\n", with: " "))
            var low = 0, high = chars.count
            while low < high {
                let mid = (low + high) / 2
                let bounds = (String(chars[mid...]) as NSString).boundingRect(with: CGSize(width: 896, height: CGFloat.greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
                if bounds.height <= limit { high = mid } else { low = mid + 1 }
            }
            (String(chars[low...]) as NSString).draw(in: CGRect(x: 32, y: y, width: 896, height: limit), withAttributes: attributes)
        }
        drawCaption(source, fontSize: bilingual ? 44 : 60, y: 28, color: UIColor(white: 0.75, alpha: 1))
        drawCaption(translation, fontSize: 60, y: bilingual ? 162 : 28, color: UIColor(white: 0.95, alpha: 1))
        UIGraphicsPopContext()
        var description: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel, formatDescriptionOut: &description) == noErr, let description else { return }
        var timing = CMSampleTimingInfo(duration: CMTime(seconds: 1, preferredTimescale: 600), presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel, formatDescription: description, sampleTiming: &timing, sampleBufferOut: &sample) == noErr, let sample else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as? [NSMutableDictionary] { attachments.first?[kCMSampleAttachmentKey_DisplayImmediately] = true }
        if layer.status == .failed { layer.flush() }
        layer.enqueue(sample)
    }
    public func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {}
    public func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange { CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity) }
    public func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool { false }
    public func pictureInPictureController(_ controller: AVPictureInPictureController, didTransitionToRenderSize size: CMVideoDimensions) {}
    public func pictureInPictureController(_ controller: AVPictureInPictureController, skipByInterval interval: CMTime, completion completionHandler: @escaping @Sendable () -> Void) { completionHandler() }
    public func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) { onError?(error.localizedDescription) }
    public func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) { completionHandler(true) }
}
#endif
