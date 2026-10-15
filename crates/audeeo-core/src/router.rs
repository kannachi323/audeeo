use crate::{Channel, EchoReducer, PcmChunk};
use std::collections::VecDeque;

/// Joins a microphone capture and a system capture without ever mixing
/// them. Each channel keeps its own frame numbering and is delivered on its
/// own. With echo reduction on, the microphone waits for the matching system
/// audio (up to `max_lag` samples) and has it subtracted.
pub struct DuplexRouter {
    echo: Option<EchoReducer>,
    reference: VecDeque<i16>,
    reference_start: u64,
    held: VecDeque<PcmChunk>,
    max_lag: usize,
}

impl DuplexRouter {
    pub fn new(echo_reduction: bool) -> Self {
        Self {
            echo: echo_reduction.then(|| EchoReducer::new(512)),
            reference: VecDeque::new(),
            reference_start: 0,
            held: VecDeque::new(),
            max_lag: 16_000 / 5,
        }
    }

    /// Accepts a chunk from either capture and returns the chunks that are
    /// ready, in order per channel.
    pub fn push(&mut self, chunk: PcmChunk) -> Vec<PcmChunk> {
        match chunk.channel {
            Channel::System => {
                let mut ready = Vec::new();
                if self.echo.is_some() {
                    if self.reference.is_empty() {
                        self.reference_start = chunk.start_frame;
                    }
                    self.reference.extend(&chunk.samples);
                    ready.extend(self.release(false));
                }
                ready.push(chunk);
                ready
            }
            Channel::Mic if self.echo.is_none() => vec![chunk],
            Channel::Mic => {
                self.held.push_back(chunk);
                self.release(false)
            }
        }
    }

    /// Releases every held microphone chunk, used when capture stops.
    pub fn flush(&mut self) -> Vec<PcmChunk> {
        self.release(true)
    }

    fn release(&mut self, force: bool) -> Vec<PcmChunk> {
        let mut ready = Vec::new();
        while let Some(front) = self.held.front() {
            let reference_end = self.reference_start + self.reference.len() as u64;
            let waiting = self.held.iter().map(|c| c.samples.len()).sum::<usize>();
            if !force && reference_end < front.end_frame() && waiting <= self.max_lag {
                break;
            }
            let mut chunk = self.held.pop_front().unwrap();
            let offset = chunk.start_frame.saturating_sub(self.reference_start) as usize;
            let reference: Vec<i16> = self
                .reference
                .iter()
                .skip(offset)
                .take(chunk.samples.len())
                .copied()
                .collect();
            if let Some(echo) = self.echo.as_mut() {
                echo.process(&mut chunk.samples, &reference);
            }
            let used = (offset + chunk.samples.len()).min(self.reference.len());
            self.reference.drain(..used);
            self.reference_start += used as u64;
            ready.push(chunk);
        }
        ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(channel: Channel, start: u64, value: i16, len: usize) -> PcmChunk {
        PcmChunk {
            channel,
            start_frame: start,
            samples: vec![value; len],
        }
    }

    #[test]
    fn channels_stay_separate_without_echo_reduction() {
        let mut router = DuplexRouter::new(false);
        let mut out = Vec::new();
        out.extend(router.push(chunk(Channel::Mic, 0, 100, 160)));
        out.extend(router.push(chunk(Channel::System, 0, -100, 160)));
        out.extend(router.push(chunk(Channel::Mic, 160, 100, 160)));
        assert_eq!(out.len(), 3);
        assert!(out
            .iter()
            .filter(|c| c.channel == Channel::Mic)
            .all(|c| c.samples.iter().all(|s| *s == 100)));
        assert!(out
            .iter()
            .filter(|c| c.channel == Channel::System)
            .all(|c| c.samples.iter().all(|s| *s == -100)));
        let mic_frames: Vec<u64> = out
            .iter()
            .filter(|c| c.channel == Channel::Mic)
            .map(|c| c.start_frame)
            .collect();
        assert_eq!(mic_frames, vec![0, 160]);
    }

    #[test]
    fn mic_waits_for_matching_reference_then_is_released() {
        let mut router = DuplexRouter::new(true);
        assert!(router.push(chunk(Channel::Mic, 0, 0, 160)).is_empty());
        let out = router.push(chunk(Channel::System, 0, 0, 160));
        assert_eq!(
            out.iter().map(|c| c.channel).collect::<Vec<_>>(),
            vec![Channel::Mic, Channel::System]
        );
    }

    #[test]
    fn mic_is_not_held_forever_when_system_audio_stalls() {
        let mut router = DuplexRouter::new(true);
        let mut released = 0;
        for index in 0..30u64 {
            released += router.push(chunk(Channel::Mic, index * 160, 5, 160)).len();
        }
        assert!(released > 0);
        released += router.flush().len();
        assert_eq!(released, 30);
    }
}
