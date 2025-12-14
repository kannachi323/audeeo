#pragma once

#include <iostream>
#include <portaudio.h>
#include <vector>
#include <queue>
#include <mutex>
#include "pa_win_wasapi.h"

constexpr int VOSK_TARGET_RATE = 16000;
constexpr int FRAMES_PER_BUFFER = 4096; 

using AudioChunk = std::vector<float>;

// Global variables to store the actual required settings found during device search
extern int ACTUAL_CAPTURE_CHANNELS;
extern double ACTUAL_CAPTURE_RATE;

class AudioProcessor {
public:
    AudioProcessor(std::queue<AudioChunk>& queue, std::mutex& mu);
    ~AudioProcessor();

    void start();
    void stop();

    // Utility function to find the specific loopback device
    PaDeviceIndex findLoopbackDevice();

private:
    PaStream *stream = nullptr;
    std::queue<AudioChunk>& audioQueue;
    std::mutex& queueMutex;

    static int paCallback(
        const void *inputBuffer, void *outputBuffer,
        unsigned long framesPerBuffer,
        const PaStreamCallbackTimeInfo *timeInfo,
        PaStreamCallbackFlags statusFlags,
        void *userData);

    void appendAudioData(const float* data, size_t size);
};