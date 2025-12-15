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
#include "audeeo/audio_queue.h"

struct WavHeader {
    char riff[4] = { 'R','I','F','F' };
    uint32_t size = 0;
    char wave[4] = { 'W','A','V','E' };

    char fmt[4] = { 'f','m','t',' ' };
    uint32_t fmtSize = 16;
    uint16_t formatTag;
    uint16_t channels;
    uint32_t sampleRate;
    uint32_t byteRate;
    uint16_t blockAlign;
    uint16_t bitsPerSample;

    char data[4] = { 'd','a','t','a' };
    uint32_t dataSize = 0;
};

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
    void InitWAVHeader(WavHeader& header);

    void Start();
    void Stop();

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
};