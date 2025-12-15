#include "audeeo/audio_text.h"

AudioText::AudioText() : running_(false) {}

AudioText::~AudioText() {
    Stop();
    vosk_recognizer_free(recognizer_);
    vosk_model_free(model_);
}

void AudioText::Init(std::string modelPath) {
    model_ = vosk_model_new(modelPath.c_str());
    if (!model_) {
        throw std::runtime_error("Failed to load Vosk model from path: " + modelPath);
    }

    recognizer_ = vosk_recognizer_new(model_, 16000.0f);
    if (!recognizer_) {
        vosk_model_free(model_);
        throw std::runtime_error("Failed to create Vosk recognizer");
    }
}

void AudioText::Start() {
    // Implementation for starting audio processing
    processAudio();
}

void AudioText::Stop() {
    // Implementation for stopping audio processing
    std::unique_lock<std::mutex> lock(mu_);
    // Signal the processing thread to stop
    cv_.notify_all();
}

void AudioText::LoadAudioQueue(AudioQueue* audioQueue) {
    audioQueue_ = audioQueue;
}

void AudioText::processAudio() {
    running_ = true;
    while (running_) {
        float* audioChunk = audioQueue_->Pop();
        if (!audioChunk) continue;

        int numSamples = audioQueue_->GetSampleCount();

        if (numSamples == 0) throw std::runtime_error("Audio chunk has zero samples");

        int final = vosk_recognizer_accept_waveform_f(
            recognizer_,
            audioChunk,
            numSamples
        );

        if (final) {
            std::cout << vosk_recognizer_result(recognizer_) << std::endl;
        } else {
            std::cout << vosk_recognizer_partial_result(recognizer_) << std::endl;
        }
        std::fflush(stdout);
    }
}

