use crate::SAMPLE_RATE;
use std::collections::VecDeque;

/// Keeps the most recent audio so speech that began a moment before the user
/// pressed a key is not clipped. It only holds what the open capture already
/// produced; it never opens a device on its own.
pub struct PreRoll {
    capacity: usize,
    samples: VecDeque<i16>,
    end_frame: u64,
}

impl PreRoll {
    pub fn new(duration_ms: u32) -> Self {
        let capacity = (SAMPLE_RATE as u64 * duration_ms as u64 / 1000) as usize;
        Self {
            capacity,
            samples: VecDeque::with_capacity(capacity),
            end_frame: 0,
        }
    }

    pub fn push(&mut self, samples: &[i16]) {
        self.end_frame += samples.len() as u64;
        if self.capacity == 0 {
            return;
        }
        let skip = samples.len().saturating_sub(self.capacity);
        for sample in &samples[skip..] {
            if self.samples.len() == self.capacity {
                self.samples.pop_front();
            }
            self.samples.push_back(*sample);
        }
    }

    /// Hands out the buffered audio, oldest first, and its first frame index.
    pub fn take(&mut self) -> (u64, Vec<i16>) {
        let start = self.end_frame - self.samples.len() as u64;
        (start, self.samples.drain(..).collect())
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    pub fn clear(&mut self) {
        self.samples.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_most_recent_window() {
        let mut preroll = PreRoll::new(1); // 16 samples
        preroll.push(&(0..10).collect::<Vec<i16>>());
        preroll.push(&(10..30).collect::<Vec<i16>>());
        let (start, samples) = preroll.take();
        assert_eq!(start, 14);
        assert_eq!(samples, (14..30).collect::<Vec<i16>>());
        assert!(preroll.is_empty());
    }

    #[test]
    fn take_continues_frame_numbering() {
        let mut preroll = PreRoll::new(10);
        preroll.push(&[1; 50]);
        assert_eq!(preroll.take(), (0, vec![1; 50]));
        preroll.push(&[2; 5]);
        assert_eq!(preroll.take(), (50, vec![2; 5]));
    }

    #[test]
    fn zero_length_holds_nothing() {
        let mut preroll = PreRoll::new(0);
        preroll.push(&[1, 2, 3]);
        assert_eq!(preroll.take(), (3, vec![]));
    }
}
