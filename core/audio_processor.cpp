#include <audeeo/audio_processor.h>
#include <stdexcept>
#include <algorithm>
#include <cmath>
#include <iostream>

#define SAFE_RELEASE(x) if (x) { x->Release(); x = nullptr; }

AudioProcessor::AudioProcessor() : deviceCount_(0), isProcessing_(false) {
    CoInitialize(nullptr);
}

AudioProcessor::~AudioProcessor() {
    Stop();
    SAFE_RELEASE(audioCaptureClient_);
    SAFE_RELEASE(audioClient_);
    SAFE_RELEASE(device_);
    SAFE_RELEASE(collection_);
    if (format_) {
        CoTaskMemFree(format_);
        format_ = nullptr;
    }
    if (audioEventHandle_) {
        CloseHandle(audioEventHandle_);
        audioEventHandle_ = nullptr;
    }
    CoUninitialize();
}

void AudioProcessor::Init(UINT deviceIndex) {
    InitAudioCollection();
    InitAudioDevice(deviceIndex);
    InitAudioClient();
    InitAudioFormat();
    InitAudioEventHandle();
    InitAudioStream();
    InitAudioCaptureClient();
}

void AudioProcessor::InitAudioCollection() {
    IMMDeviceEnumerator* enumerator = nullptr;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        (void**)&enumerator
    );
    if (FAILED(hr)) throw std::runtime_error("Device enumerator failed");

    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection_);
    SAFE_RELEASE(enumerator);
    if (FAILED(hr)) throw std::runtime_error("EnumAudioEndpoints failed");

    UINT count = 0;
    hr = collection_->GetCount(&count);
    if (FAILED(hr) || count == 0) throw std::runtime_error("No devices found");

    deviceCount_ = count;
}

void AudioProcessor::InitAudioDevice(UINT index) {
    if (index >= deviceCount_) throw std::runtime_error("Invalid device index");
    HRESULT hr = collection_->Item(index, &device_);
    if (FAILED(hr)) throw std::runtime_error("Failed to get device");
}

void AudioProcessor::InitAudioClient() {
    HRESULT hr = device_->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        (void**)&audioClient_
    );
    if (FAILED(hr)) throw std::runtime_error("Activate IAudioClient failed");
}

void AudioProcessor::InitAudioFormat() {
    if (format_) {
        CoTaskMemFree(format_);
        format_ = nullptr;
    }
    HRESULT hr = audioClient_->GetMixFormat(&format_);
    if (FAILED(hr)) throw std::runtime_error("GetMixFormat failed");
}

void AudioProcessor::InitAudioEventHandle() {
    audioEventHandle_ = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (!audioEventHandle_) throw std::runtime_error("CreateEvent failed");
}

void AudioProcessor::InitAudioStream() {
    HRESULT hr = audioClient_->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_LOOPBACK,
        0,
        0,
        format_,
        nullptr
    );
    if (FAILED(hr)) throw std::runtime_error("Initialize failed");

    hr = audioClient_->SetEventHandle(audioEventHandle_);
    if (FAILED(hr)) throw std::runtime_error("SetEventHandle failed");
}

void AudioProcessor::InitAudioCaptureClient() {
    HRESULT hr = audioClient_->GetService(
        __uuidof(IAudioCaptureClient),
        (void**)&audioCaptureClient_
    );
    if (FAILED(hr)) throw std::runtime_error("GetService failed");
}

void AudioProcessor::InitWAVHeader(WavHeader& header) {
    header.formatTag = 1;
    header.channels = format_->nChannels;
    header.sampleRate = format_->nSamplesPerSec;
    header.bitsPerSample = 16;
    header.blockAlign = header.channels * 2;
    header.byteRate = header.sampleRate * header.blockAlign;
}

void AudioProcessor::Start() {
    if (!audioClient_ || !audioCaptureClient_ || !format_ || !audioEventHandle_)
        throw std::runtime_error("Not initialized");

    bool isFloat = format_->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
        ((WAVEFORMATEXTENSIBLE*)format_)->SubFormat ==
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;

    if (!isFloat) throw std::runtime_error("Mix format not float");

    HRESULT hr = audioClient_->Start();
    if (FAILED(hr)) throw std::runtime_error("Start failed");

    isProcessing_ = true;
    const float noiseThreshold = 0.00001f;

    while (isProcessing_) {
        WaitForSingleObject(audioEventHandle_, INFINITE);

        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;

        hr = audioCaptureClient_->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) throw std::runtime_error("GetBuffer failed");

        if (frames == 0) {
            audioCaptureClient_->ReleaseBuffer(0);
            continue;
        }

        float* samples = static_cast<float*>(static_cast<void*>(data));
        int sampleCount = frames * format_->nChannels;
        float peak = 0.0f;

        for (int i = 0; i < sampleCount; ++i) {
            float s = samples[i];
            if (std::fabs(s) < noiseThreshold) s = 0.0f;
            peak = std::max(peak, std::fabs(s));
        }

        //std::printf("\rLevel: %.4f   ", peak);
        std::fflush(stdout);

        float* audioChunk = new float[sampleCount];
        std::copy(samples, samples + sampleCount, audioChunk);
        audioQueue_->Push(audioChunk);
        audioQueue_->SetSampleCount(sampleCount);


        audioCaptureClient_->ReleaseBuffer(frames);
    }
}

void AudioProcessor::Stop() {
    if (isProcessing_) {
        isProcessing_ = false;
        if (audioClient_) audioClient_->Stop();
    }
}

void AudioProcessor::ListAudioDevices() {
    for (UINT i = 0; i < deviceCount_; ++i) {
        IMMDevice* device = nullptr;
        collection_->Item(i, &device);

        IPropertyStore* props = nullptr;
        device->OpenPropertyStore(STGM_READ, &props);

        PROPVARIANT varName;
        PropVariantInit(&varName);
        props->GetValue(PKEY_Device_FriendlyName, &varName);

        std::wcout << L"Device: " << i << L": " << varName.pwszVal << std::endl;

        PropVariantClear(&varName);
        SAFE_RELEASE(props);
        SAFE_RELEASE(device);
    }
}

void AudioProcessor::LoadAudioQueue(AudioQueue* audioQueue) {
    audioQueue_ = audioQueue;
}
