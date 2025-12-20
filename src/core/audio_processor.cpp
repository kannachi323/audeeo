#include "audeeo/audio_processor.h"

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

    resampler_.init(format_->nSamplesPerSec, 16000); //format_ is expected to be non-null here

    InitFvad(1, 16000);
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

void AudioProcessor::InitFvad(int mode, int sample_rate) {
    fvad_ = fvad_new();
    if (!fvad_) {
        throw std::runtime_error("Failed to create Fvad instance");
    }

    if (fvad_set_mode(fvad_, mode) != 0) {
        fvad_free(fvad_);
        throw std::runtime_error("Failed to set Fvad mode");
    }

    if (fvad_set_sample_rate(fvad_, sample_rate) != 0) {
        fvad_free(fvad_);
        throw std::runtime_error("Failed to set Fvad sample rate");
    }
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
    BYTE* data = nullptr;
    UINT32 frames = 0;
    DWORD flags = 0;


    while (isProcessing_) {
        // Wait for a buffer to be ready
        WaitForSingleObject(audioEventHandle_, INFINITE);

        hr = audioCaptureClient_->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) throw std::runtime_error("GetBuffer failed");

        if (frames == 0) {
            audioCaptureClient_->ReleaseBuffer(0);
            continue;
        }

        float* samples = reinterpret_cast<float*>(data);
        int channels = format_->nChannels;
        
        std::vector<float> mono(frames);
        downmixToMono(samples, frames, channels, mono);

        std::vector<float> resampled;
        resampler_.resample(mono.data(), mono.size(), resampled);

        std::vector<int16_t> pcm(resampled.size());
        convertToPCM16(resampled.data(), pcm.data(), resampled.size(), pcm);


        audioQueue_->Push(std::move(pcm));

        audioCaptureClient_->ReleaseBuffer(frames);
    }
}

void AudioProcessor::Stop() {
    if (isProcessing_) {
        isProcessing_ = false;
        if (audioClient_) audioClient_->Stop();
    }
}

// Fixed signature to remove the redundant std::vector<int16_t>& pcm argument
void AudioProcessor::convertToPCM16(const float* input, int16_t* output, size_t frames, std::vector<int16_t>& pcm) {
    for (size_t i = 0; i < pcm.size(); ++i) {
        pcm[i] = static_cast<int16_t>(std::clamp(input[i], -1.0f, 1.0f) * 32767);
    }
}

void AudioProcessor::downmixToMono(const float* input, size_t frames, int channels, std::vector<float>& mono) {
    for (UINT32 i = 0; i < frames; ++i) {
        float sum = 0.f;
        for (int ch = 0; ch < channels; ++ch)
            sum += input[i * channels + ch];
        float monoSample = sum / channels;
        //remove any static that was capture in the loopback when audio < 0
        if (fabsf(monoSample) < NOISE_THRESHOLD_) monoSample = 0.f;

        mono[i] = monoSample;        
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
