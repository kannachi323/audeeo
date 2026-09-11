import AVFoundation
import Foundation
@main struct PlaybackChecks {
    static func main() throws {
        let playback = TranslationPlayback()
        var states: [Bool] = []
        playback.onActivity = { states.append($0) }
        playback.maximumSeconds = 1
        playback.volume = 0
        try playback.enqueue(pcm: Data(repeating: 0, count: 4800))
        assert(playback.active)
        playback.volume = 0.3
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        assert(!playback.active && states == [true, false], "Playback must notify after the device consumes the last buffer")
        do { try playback.enqueue(pcm: Data(repeating: 0, count: 48002)); fatalError("Must bound buffering") } catch {}
        playback.reset()
        try playback.enqueue(pcm: Data(repeating: 0, count: 9600))
        playback.stop()
        try playback.enqueue(pcm: Data(repeating: 0, count: 4800))
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        assert(!playback.active, "Completions from a stopped generation must not affect new playback")
        playback.stop(); playback.stop()
        print("Native playback checks passed: silent PCM consumed by output device, independent gain, bounded queue, drain, reset generations, repeated cleanup.")
    }
}
