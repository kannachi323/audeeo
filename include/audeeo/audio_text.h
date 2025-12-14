#pragma once

#include <iostream>
#include <string>
#include <mutex>
#include <vector>
#include <thread>
#include <condition_variable>

#include <vosk/vosk_api.h>

class AudioText {
public:
    AudioText(std::string model_path);
    ~AudioText();

    void start();
    void stop();

private:
    void processAudio();

    bool running_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::vector<void*> audio_queue_;
    VoskModel* model_;
    VoskRecognizer* recognizer_;
};