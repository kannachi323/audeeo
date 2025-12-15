#pragma once

#include <iostream>
#include <string>
#include <mutex>
#include <vector>
#include <thread>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <condition_variable>
#include <vosk/vosk_api.h>
#include "audeeo/audio_queue.h"

class AudioText {
public:
    AudioText();
    ~AudioText();
    void Init(std::string modelPath);

    void Start();
    void Stop();

    void LoadAudioQueue(AudioQueue* audioQueue); //careful, this needs to have proper synchronization

private:
    void processAudio();

    bool running_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::vector<void*> audio_queue_;
    VoskModel* model_;
    VoskRecognizer* recognizer_;
    AudioQueue* audioQueue_;
};