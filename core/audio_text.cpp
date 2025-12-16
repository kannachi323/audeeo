#include "audeeo/audio_text.h"

using json = nlohmann::json;

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

void AudioText::LoadTextQueue(TextQueue* sourceQueue) {
    sourceQueue_ = sourceQueue;
}

inline void parse_vosk_partial(const char* partial_json, std::string& text) {
    json data = json::parse(partial_json);

    text = data["partial"].get<std::string>();
}

void AudioText::processAudio() {
    std::vector<int16_t> chunk;
    std::string lastPartial;

    while (audioQueue_->Pop(chunk)) {
        if (chunk.empty()) continue;

        // Treat chunk as raw bytes
        const char* ptr = reinterpret_cast<const char*>(chunk.data()); // <-- still need some kind of reinterpret
        size_t byteSize = chunk.size() * sizeof(int16_t);

        // Instead of reinterpret_cast, we can copy data into a std::string
        std::string buffer(reinterpret_cast<const char*>(chunk.data()), byteSize);

        int accepted = vosk_recognizer_accept_waveform(
            recognizer_,
            buffer.data(),   // no cast needed here
            buffer.size()
        );

        // Partial result
        std::string partialText;
        parse_vosk_partial(vosk_recognizer_partial_result(recognizer_), partialText);

        if (!partialText.empty() && partialText != lastPartial && sourceQueue_) {
            sourceQueue_->Push(partialText);
            lastPartial = partialText;
        }

        // Handle final result if utterance completed
        if (accepted == 1) {
            const char* finalJson = vosk_recognizer_result(recognizer_);
            std::string finalText;
            parse_vosk_partial(finalJson, finalText);
            if (!finalText.empty() && sourceQueue_) {
                sourceQueue_->Push(finalText);
            }
            lastPartial.clear();
        }
    }
}


