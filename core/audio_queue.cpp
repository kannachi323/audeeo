#include <audeeo/audio_queue.h>

AudioQueue::AudioQueue() {}

AudioQueue::~AudioQueue() {
    while (!audioQueue_.empty()) {
        float* chunk = audioQueue_.front();
        audioQueue_.pop();
        delete[] chunk;
    }
}

void AudioQueue::Push(float* audioChunk) {
    std::lock_guard<std::mutex> lock(mu_);
    audioQueue_.push(audioChunk);
    cv_.notify_one();
}

float* AudioQueue::Pop() {
    std::unique_lock<std::mutex> lock(mu_);
    cv_.wait(lock, [this]() { return !audioQueue_.empty(); });
    float* chunk = audioQueue_.front();
    audioQueue_.pop();

    return chunk;
}

bool AudioQueue::IsEmpty() {
    std::lock_guard<std::mutex> lock(mu_);
    return audioQueue_.empty();
}

bool AudioQueue::SetSampleCount(int count) {
    std::lock_guard<std::mutex> lock(mu_);
    sampleCount = count;
    return true;
}

int AudioQueue::GetSampleCount() {
    std::lock_guard<std::mutex> lock(mu_);
    return sampleCount;
}