#include "audeeo/audio_processor.h"
#include <cstring>

int ACTUAL_CAPTURE_CHANNELS = 0;
double ACTUAL_CAPTURE_RATE = 0.0;

AudioProcessor::AudioProcessor(std::queue<AudioChunk>& queue, std::mutex& mu)
    : audioQueue(queue), queueMutex(mu)
{
    Pa_Initialize();
}

AudioProcessor::~AudioProcessor()
{
    stop();
    Pa_Terminate();
}

PaDeviceIndex AudioProcessor::findLoopbackDevice()
{
    int hostApiCount = Pa_GetHostApiCount();
    for (int i = 0; i < hostApiCount; ++i)
    {
        const PaHostApiInfo* host = Pa_GetHostApiInfo(i);
        if (host && host->type == paWASAPI)
        {
            std::cout << "Using host API: " << host->name << "\n";
            return host->defaultOutputDevice;
        }
    }

    std::cerr << "WASAPI host API not found\n";
    return paNoDevice;
}

void AudioProcessor::start()
{
    if (stream)
        return;

    PaDeviceIndex device = findLoopbackDevice();
    if (device == paNoDevice)
        return;

    const PaDeviceInfo* info = Pa_GetDeviceInfo(device);
    std::cout << "Using device: " << info->name << "\n";

    ACTUAL_CAPTURE_RATE = info->defaultSampleRate;
    ACTUAL_CAPTURE_CHANNELS =
        info->maxInputChannels > 0
            ? info->maxInputChannels
            : info->maxOutputChannels;

    // WASAPI loopback info
    PaWasapiStreamInfo wasapiInfo;
    std::memset(&wasapiInfo, 0, sizeof(wasapiInfo));
    wasapiInfo.size = sizeof(PaWasapiStreamInfo);
    wasapiInfo.hostApiType = paWASAPI;
    wasapiInfo.version = 1;


    PaStreamParameters inputParams;
    std::memset(&inputParams, 0, sizeof(inputParams));
    inputParams.device = device;
    inputParams.channelCount = ACTUAL_CAPTURE_CHANNELS;
    inputParams.sampleFormat = paFloat32;
    inputParams.suggestedLatency = info->defaultLowInputLatency;
    inputParams.hostApiSpecificStreamInfo = &wasapiInfo;

    PaError err = Pa_OpenStream(
        &stream,
        &inputParams,      // input (loopback!)
        nullptr,           // no output
        ACTUAL_CAPTURE_RATE,
        FRAMES_PER_BUFFER,
        paNoFlag,
        &AudioProcessor::paCallback,
        this
    );

    if (err != paNoError)
    {
        std::cerr << "Pa_OpenStream failed: "
                  << Pa_GetErrorText(err) << "\n";
        stream = nullptr;
        return;
    }

    Pa_StartStream(stream);
}

void AudioProcessor::stop()
{
    if (!stream)
        return;

    Pa_StopStream(stream);
    Pa_CloseStream(stream);
    stream = nullptr;
}

int AudioProcessor::paCallback(
    const void *inputBuffer,
    void * /*outputBuffer*/,
    unsigned long framesPerBuffer,
    const PaStreamCallbackTimeInfo*,
    PaStreamCallbackFlags,
    void *userData)
{
    auto* self = static_cast<AudioProcessor*>(userData);

    if (!inputBuffer)
        return paContinue;

    const float* in = static_cast<const float*>(inputBuffer);
    size_t samples = framesPerBuffer * ACTUAL_CAPTURE_CHANNELS;

    self->appendAudioData(in, samples);

    return paContinue;
}

void AudioProcessor::appendAudioData(const float* data, size_t size)
{
    AudioChunk chunk(data, data + size);

    std::lock_guard<std::mutex> lock(queueMutex);
    audioQueue.push(std::move(chunk));
}




