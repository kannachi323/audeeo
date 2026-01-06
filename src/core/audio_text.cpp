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

void AudioText::parse_vosk_partial(const char* partial_json, std::string& text) {
    json data = json::parse(partial_json);

    text = data["partial"].get<std::string>();
}

void AudioText::parse_vosk_final(const char* final_json, std::string& text) {
    json data = json::parse(final_json);

    text = data["text"].get<std::string>();
}

void AudioText::getLastNWords(const std::string& text, std::vector<std::string>& newWordsContext) {
    std::stringstream ss(text);
    std::string word;

    newWordsContext.clear();

    while (ss >> word) {
        newWordsContext.push_back(word);
        if (newWordsContext.size() > MAX_CONTEXT_SIZE_)
            newWordsContext.erase(newWordsContext.begin());
    }
}

bool AudioText::getUpdatedText(const std::string& partialText, std::string& finalText) {
    static size_t lastLen = 0;

    if (partialText.empty()) return false;

    if (partialText.size() < lastLen) {
        wordsContext_.clear();
        lastLen = 0;
    }

    if (partialText.size() == lastLen) return false;

    std::string delta = partialText.substr(lastLen);
    lastLen = partialText.size();

    std::stringstream ss(delta);
    std::string word;
    bool changed = false;

    while (ss >> word) {
        wordsContext_.push_back(word);
        if (wordsContext_.size() > MAX_CONTEXT_SIZE_)
            wordsContext_.erase(wordsContext_.begin());
        changed = true;
    }

    if (changed) finalText = partialText;
    return changed;
}

void AudioText::processAudio() {
    std::vector<int16_t> chunk;
    std::string partialText;
    std::string finalText;
    std::string updatedText;
    int final;

    while (audioQueue_->Pop(chunk)) {
        if (chunk.empty()) continue;

        size_t BUF_SIZE = chunk.size() * sizeof(int16_t);

        final = vosk_recognizer_accept_waveform(
            recognizer_,
            (const char*)chunk.data(),
            BUF_SIZE
        );

        
        if (final) {
            parse_vosk_final(vosk_recognizer_result(recognizer_), finalText);
            sourceQueue_->Push(finalText + "</s>");
            partialText.clear();
            updatedText.clear();
            finalText.clear();
        } else {
            parse_vosk_partial(vosk_recognizer_partial_result(recognizer_), partialText);
            
            if (getUpdatedText(partialText, updatedText)) {
                sourceQueue_->Push(updatedText);
            }
        }
    }
}