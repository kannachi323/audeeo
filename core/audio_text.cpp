#include "audeeo/audio_text.h"

AudioText::AudioText(std::string model_path) : running_(false) {
    model_ = vosk_model_new(model_path.c_str());
    if (!model_) {
        throw std::runtime_error("Failed to load Vosk model from path: " + model_path);
    }
    recognizer_ = vosk_recognizer_new(model_, 16000.0f);
    if (!recognizer_) {
        vosk_model_free(model_);
        throw std::runtime_error("Failed to create Vosk recognizer.");
    }
}

AudioText::~AudioText() {
    stop();
    vosk_recognizer_free(recognizer_);
    vosk_model_free(model_);
}

void AudioText::start() {
    // Implementation for starting audio processing
    std::thread(&AudioText::processAudio, this).detach();
}

void AudioText::stop() {
    // Implementation for stopping audio processing
    std::unique_lock<std::mutex> lock(mu_);
    // Signal the processing thread to stop
    cv_.notify_all();
}

// Assuming ThreadSafeQueue<std::vector<short>> audio_queue_ and bool running_ member variables.

void AudioText::processAudio() {
    
    while (running_) {
        const char* partial_json = vosk_recognizer_partial_result(recognizer_);
        std::cout << partial_json << std::endl;
    }
}
