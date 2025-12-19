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

#define SAFE_RELEASE(x) if (x) { x->Release(); x = nullptr; }

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

int main() {
    HRESULT hr;
    CoInitialize(nullptr);

    IMMDeviceEnumerator* enumerator = nullptr;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
    if (FAILED(hr)) return 1;

    // Enumerate all active playback devices
    IMMDeviceCollection* collection = nullptr;
    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr)) return 1;

    UINT count = 0;
    collection->GetCount(&count);
    if (count == 0) {
        printf("No active playback devices found.\n");
        return 1;
    }

    printf("Active playback devices:\n");
    for (UINT i = 0; i < count; ++i) {
        IMMDevice* dev = nullptr;
        collection->Item(i, &dev);

        IPropertyStore* props = nullptr;
        dev->OpenPropertyStore(STGM_READ, &props);

        PROPVARIANT varName;
        PropVariantInit(&varName);
        props->GetValue(PKEY_Device_FriendlyName, &varName);

        wprintf(L"%u: %s\n", i, varName);

        PropVariantClear(&varName);
        props->Release();
        dev->Release();
    }

    UINT choice = 0;
    printf("Select device index to capture: ");
    scanf("%u", &choice);
    if (choice >= count) {
        printf("Invalid device index.\n");
        return 1;
    }

    IMMDevice* device = nullptr;
    collection->Item(choice, &device);

    SAFE_RELEASE(collection);
    SAFE_RELEASE(enumerator);

    IAudioClient* audioClient = nullptr;
    IAudioCaptureClient* captureClient = nullptr;

    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&audioClient);
    if (FAILED(hr)) return 1;

    WAVEFORMATEX* format = nullptr;
    audioClient->GetMixFormat(&format);

    HANDLE eventHandle = CreateEvent(nullptr, FALSE, FALSE, nullptr);

    hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        0, 0, format, nullptr
    );
    if (FAILED(hr)) return 1;

    audioClient->SetEventHandle(eventHandle);

    hr = audioClient->GetService(__uuidof(IAudioCaptureClient), (void**)&captureClient);
    if (FAILED(hr)) return 1;

    // --- WAV setup ---
    FILE* file = fopen("output.wav", "wb");

    WavHeader header{};
    header.formatTag = 1; // PCM16
    header.channels = format->nChannels;
    header.sampleRate = format->nSamplesPerSec;
    header.bitsPerSample = 16;
    header.blockAlign = header.channels * 2;
    header.byteRate = header.sampleRate * header.blockAlign;

    fwrite(&header, sizeof(header), 1, file);
    uint32_t totalBytesWritten = 0;

    audioClient->Start();
    printf("Recording system audio to output.wav (Ctrl+C to stop)\n");

    const float noiseThreshold = 0.00001f; // very gentle noise gate

    while (true) {
        WaitForSingleObject(eventHandle, INFINITE);

        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;

        hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) break;
        if (frames == 0) continue;

        float* samples = (float*)data;
        int sampleCount = frames * format->nChannels;
        float peak = 0.f;

        for (int i = 0; i < sampleCount; ++i) {
            float s = samples[i];
            if (fabsf(s) < noiseThreshold) s = 0.f;
            peak = std::max(peak, fabsf(s));

            int16_t outSample = (int16_t)(std::max(-1.f, std::min(1.f, s)) * 32767);
            fwrite(&outSample, sizeof(int16_t), 1, file);
            totalBytesWritten += sizeof(int16_t);
        }

        printf("\rLevel: %.4f   ", peak);
        fflush(stdout);

        captureClient->ReleaseBuffer(frames);
    }

    audioClient->Stop();

    // --- Fix WAV header ---
    header.dataSize = totalBytesWritten;
    header.size = totalBytesWritten + sizeof(WavHeader) - 8;

    fseek(file, 0, SEEK_SET);
    fwrite(&header, sizeof(header), 1, file);
    fclose(file);

    SAFE_RELEASE(captureClient);
    SAFE_RELEASE(audioClient);
    SAFE_RELEASE(device);
    CoTaskMemFree(format);
    CloseHandle(eventHandle);
    CoUninitialize();
    return 0;
}
