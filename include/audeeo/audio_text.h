#pragma once

#include <iostream>
#include <string>
#include <mutex>
#include <vector>
#include <thread>
#include <fstream>
#include <string>
#include <queue>
#include <sstream>
#include <cmath>
#include <algorithm>
#include <condition_variable>
#include <vosk/vosk_api.h>
#include <nlohmann/json.hpp>

#include "audeeo/queue.h"

class AudioText {
public:
    AudioText();
    ~AudioText();
    void Init(std::string modelPath);

    void Start();
    void Stop();

    void LoadAudioQueue(AudioQueue* audioQueue); //careful, this needs to have proper synchronization
    void LoadTextQueue(TextQueue* sourceQueue);

    bool getUpdatedText(const std::string& partialText, std::string& finalText);
    void parse_vosk_partial(const char* partial_json, std::string& text);
    void parse_vosk_final(const char* final_json, std::string& text);
    void getLastNWords(const std::string& text, std::vector<std::string>& newWordsContext);
    
private:
    void processAudio();

    bool running_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::vector<void*> audio_queue_;
    VoskModel* model_;
    VoskRecognizer* recognizer_;
    AudioQueue* audioQueue_;
    TextQueue* sourceQueue_;

    std::vector<std::string> wordsContext_;
    constexpr static size_t MAX_CONTEXT_SIZE_ = 5;


};