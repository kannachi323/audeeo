#include "audeeo/audio_processor.h"
#include <iostream>
#include <algorithm>
#include <string>
#include <cmath>
#include <iomanip>

// Initialization of the global variables (set to default/invalid values initially)
int ACTUAL_CAPTURE_CHANNELS = 0;
double ACTUAL_CAPTURE_RATE = 0.0;

AudioProcessor::AudioProcessor(
    std::queue<AudioChunk>& sharedQueue, 
    std::mutex& sharedMutex)
    : audioQueue(sharedQueue), queueMutex(sharedMutex)
{
    PaError err = Pa_Initialize();
    if (err != paNoError) {
        std::cerr << "PortAudio initialization error: " << Pa_GetErrorText(err) << std::endl;
    }
}

AudioProcessor::~AudioProcessor() {
    stop(); 
    Pa_Terminate(); 
}

float get_peak_amplitude(const float* data, size_t size) {
    float max_amplitude = 0.0f;
    for (size_t i = 0; i < size; ++i) {
        float absolute_value = std::abs(data[i]);
        if (absolute_value > max_amplitude) {
            max_amplitude = absolute_value;
        }
    }
    return max_amplitude;
}

void AudioProcessor::appendAudioData(const float* data, size_t size) {
    // ... [size check] ...
    
    float peak_amplitude = get_peak_amplitude(data, size); // Need a helper to return the max value
    
    // Print the actual peak volume value, formatted for clarity
    std::cout << "Peak: " << std::fixed << std::setprecision(5) << peak_amplitude << std::flush; 

    if (peak_amplitude > 0.01f) {
        // ... queue the chunk ...
        std::cout << " [VOICE]" << std::endl;
    } else {
        std::cout << " [SILENCE]" << std::endl;
    }
}

int AudioProcessor::paCallback(
    const void *inputBuffer, void *outputBuffer,
    unsigned long framesPerBuffer,
    const PaStreamCallbackTimeInfo *timeInfo,
    PaStreamCallbackFlags statusFlags,
    void *userData)
{
    AudioProcessor *processor = static_cast<AudioProcessor *>(userData);

    if (inputBuffer == nullptr || processor == nullptr) {
        return paContinue;
    }
    
    if (statusFlags & paInputOverflow) {
        std::cerr << "Warning: Input overflow detected in PortAudio callback." << std::endl;
    }

    const float *in = static_cast<const float *>(inputBuffer);
    size_t size = framesPerBuffer * ACTUAL_CAPTURE_CHANNELS;

    
    std::cout << *in << std::endl;
    processor->appendAudioData(in, size);
    

    return paContinue;
}

PaDeviceIndex AudioProcessor::findLoopbackDevice() {
    int numDevices = Pa_GetDeviceCount();
    if (numDevices < 0) {
        std::cerr << "PortAudio Error: Device count failed." << std::endl;
        return paNoDevice;
    }

    const char* LOOPBACK_NAME = "Stereo Mix"; 

    for (int i = 0; i < numDevices; i++) {
        const PaDeviceInfo* deviceInfo = Pa_GetDeviceInfo(i);
        std::string deviceName(deviceInfo->name);
        
        if (deviceName.find(LOOPBACK_NAME) != std::string::npos && deviceInfo->maxInputChannels > 0) {
            
            ACTUAL_CAPTURE_CHANNELS = deviceInfo->maxInputChannels;
            ACTUAL_CAPTURE_RATE = deviceInfo->defaultSampleRate; 
            
            std::cout << "Found Loopback Device: " << deviceName 
                      << " | Channels: " << ACTUAL_CAPTURE_CHANNELS
                      << " | Rate: " << ACTUAL_CAPTURE_RATE << " Hz" << std::endl;

            return i;
        }
    }
    
    std::cerr << "Loopback device not found." << std::endl;
    return paNoDevice;
}


void AudioProcessor::start() {
    if (stream) {
        std::cout << "Stream is already running." << std::endl;
        return;
    }

    PaStreamParameters inputParameters;

    inputParameters.device = findLoopbackDevice();
    
    if (inputParameters.device == paNoDevice) {
        std::cerr << "Error: Loopback device not found or configured. Cannot start stream." << std::endl;
        return;
    }
    
    inputParameters.channelCount = ACTUAL_CAPTURE_CHANNELS;
    inputParameters.sampleFormat = paFloat32;
    inputParameters.suggestedLatency = Pa_GetDeviceInfo(inputParameters.device)->defaultLowInputLatency;
    inputParameters.hostApiSpecificStreamInfo = nullptr;

    PaError err = Pa_OpenStream(
        &stream,
        &inputParameters,
        nullptr,
        ACTUAL_CAPTURE_RATE,
        FRAMES_PER_BUFFER,
        paClipOff,
        paCallback,
        this
    );

    if (err != paNoError) {
        std::cerr << "Error opening stream with parameters (Rate: " << ACTUAL_CAPTURE_RATE 
                  << ", Channels: " << ACTUAL_CAPTURE_CHANNELS 
                  << "): " << Pa_GetErrorText(err) << std::endl;
        stream = nullptr;
        return;
    }

    err = Pa_StartStream(stream);
    if (err != paNoError) {
        std::cerr << "Error starting stream: " << Pa_GetErrorText(err) << std::endl;
        Pa_CloseStream(stream);
        stream = nullptr;
        return;
    }
    std::cout << "Audio stream successfully started (" << ACTUAL_CAPTURE_RATE << "Hz, " << ACTUAL_CAPTURE_CHANNELS << " channels)." << std::endl;
}

void AudioProcessor::stop() {
    if (stream) {
        PaError err = Pa_StopStream(stream);
        if (err != paNoError) {
             std::cerr << "Error stopping stream: " << Pa_GetErrorText(err) << std::endl;
        }
        Pa_CloseStream(stream);
        stream = nullptr;
        std::cout << "Audio stream stopped." << std::endl;
    }
}