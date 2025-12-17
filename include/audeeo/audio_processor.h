#pragma once
#define _CRT_SECURE_NO_WARNINGS

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>
#include <cstdio>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <vector>
#include <stdexcept>
#include <iostream>
#include <fstream>
#include "audeeo/queue.h"
#include "audeeo/audio_resampler.h"


class AudioProcessor {
public:
    AudioProcessor();
    ~AudioProcessor();

    void Init(UINT deviceIndex = 0);
    void InitAudioCollection();
    void InitAudioDevice(UINT deviceIndex = 0);
    void InitAudioFormat();
    void InitAudioEventHandle();
    void InitAudioStream();
    void InitAudioClient();
    void InitAudioCaptureClient();

    void Start();
    void Stop();

    void downmixToMono(const float* input, size_t frames, int channels, std::vector<float>& mono);
    void convertToPCM16(const float* input, int16_t* output, size_t frames, std::vector<int16_t>& pcm);

    void ListAudioDevices();
    void LoadAudioQueue(AudioQueue* audioQueue); //careful, this needs to have proper synchronization

private:
    UINT deviceCount_;
    IMMDeviceCollection* collection_ = nullptr;
    IMMDevice* device_ = nullptr;
    IAudioClient* audioClient_ = nullptr;
    IAudioCaptureClient* audioCaptureClient_ = nullptr;
    WAVEFORMATEX* format_ = nullptr;
    HANDLE audioEventHandle_ = nullptr;

    bool isProcessing_ = false;
    AudioQueue* audioQueue_;

    AudioResampler resampler_;
    
    std::vector<std::vector<int16_t>> audioBuffer_; //will hold ~1600 samples for 100ms at 16kHz

    constexpr static float NOISE_THRESHOLD_ = 0.0001f;
    constexpr static size_t CHUNK_THRESHOLD_ = 1600;
};