use crate::SAMPLE_RATE;

/// Stateful downmix and linear resample from any device format to 16 kHz
/// mono PCM16. Position carries across calls, so packet boundaries never
/// click or drift.
pub struct Resampler {
    rate: u32,
    channels: usize,
    step: f64,
    /// Output samples produced and input frames dropped so far. Position is
    /// derived from these integers, so it never accumulates rounding and the
    /// output is identical however the input is chunked.
    produced: u64,
    dropped: u64,
    pending: Vec<f32>,
}

impl Resampler {
    pub fn new(rate: u32, channels: usize) -> Self {
        Self::to_rate(rate, channels, SAMPLE_RATE)
    }

    /// Resample to a rate other than 16 kHz (for example 24 kHz for a
    /// transcriber that wants it).
    pub fn to_rate(rate: u32, channels: usize, output_rate: u32) -> Self {
        assert!(rate > 0 && output_rate > 0 && channels > 0);
        Self {
            rate,
            channels,
            step: rate as f64 / output_rate as f64,
            produced: 0,
            dropped: 0,
            pending: Vec::new(),
        }
    }

    pub fn input_rate(&self) -> u32 {
        self.rate
    }

    /// Interleaved float input in -1..=1.
    pub fn push_f32(&mut self, interleaved: &[f32], output: &mut Vec<i16>) {
        for frame in interleaved.chunks_exact(self.channels) {
            self.pending
                .push(frame.iter().sum::<f32>() / self.channels as f32);
        }
        self.drain(output);
    }

    /// Interleaved PCM16 input.
    pub fn push_i16(&mut self, interleaved: &[i16], output: &mut Vec<i16>) {
        for frame in interleaved.chunks_exact(self.channels) {
            self.pending.push(
                frame.iter().map(|s| *s as f32 / 32768.0).sum::<f32>() / self.channels as f32,
            );
        }
        self.drain(output);
    }

    fn drain(&mut self, output: &mut Vec<i16>) {
        loop {
            // Absolute input positions, computed from integers each time.
            let start = self.produced as f64 * self.step;
            let index = start.floor() as u64 - self.dropped;
            let index = index as usize;
            // Downsampling averages the span one output sample covers, so
            // high frequencies fold in less; wait until that span is whole.
            let end = if self.step > 1.0 {
                ((self.produced + 1) as f64 * self.step).floor() as u64 - self.dropped
            } else {
                index as u64 + 1
            } as usize;
            if end >= self.pending.len() {
                break;
            }
            let value = if self.step > 1.0 {
                let span = &self.pending[index..end.max(index + 1)];
                span.iter().sum::<f32>() / span.len() as f32
            } else {
                let fraction = start.fract() as f32;
                self.pending[index] * (1.0 - fraction) + self.pending[index + 1] * fraction
            };
            output.push(to_i16(value));
            self.produced += 1;
        }
        let next = (self.produced as f64 * self.step).floor() as u64;
        let consumed = ((next - self.dropped) as usize).min(self.pending.len());
        self.pending.drain(..consumed);
        self.dropped += consumed as u64;
    }
}

pub(crate) fn to_i16(sample: f32) -> i16 {
    let sample = sample.clamp(-1.0, 1.0);
    if sample < 0.0 {
        (sample * 32768.0) as i16
    } else {
        (sample * 32767.0) as i16
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_48k_becomes_mono_16k() {
        let mut resampler = Resampler::new(48_000, 2);
        let mut output = Vec::new();
        // One second of a constant stereo signal at different channel levels.
        let input: Vec<f32> = (0..48_000).flat_map(|_| [0.6f32, 0.2]).collect();
        resampler.push_f32(&input, &mut output);
        assert!(
            (15_990..=16_000).contains(&output.len()),
            "{}",
            output.len()
        );
        assert!(output.iter().all(|s| (*s - 13106).abs() <= 2));
    }

    #[test]
    fn chunk_boundaries_do_not_change_the_output() {
        let input: Vec<f32> = (0..44_100).map(|i| (i as f32 * 0.01).sin() * 0.5).collect();
        let mut whole = Vec::new();
        Resampler::new(44_100, 1).push_f32(&input, &mut whole);
        let mut split = Vec::new();
        let mut resampler = Resampler::new(44_100, 1);
        for part in input.chunks(733) {
            resampler.push_f32(part, &mut split);
        }
        let first = whole.iter().zip(&split).position(|(a, b)| a != b);
        assert_eq!((whole.len(), first), (split.len(), None));
    }

    #[test]
    fn upsampling_interpolates() {
        let mut resampler = Resampler::to_rate(16_000, 1, 24_000);
        let mut output = Vec::new();
        resampler.push_i16(&[0, 3000, 6000, 9000], &mut output);
        assert_eq!(output[0], 0);
        assert!((output[1] - 2000).abs() <= 1, "{output:?}");
        assert!((output[2] - 4000).abs() <= 1, "{output:?}");
    }

    #[test]
    fn clamps_out_of_range_samples() {
        assert_eq!(to_i16(2.0), i16::MAX);
        assert_eq!(to_i16(-2.0), i16::MIN);
    }
}
