#pragma once
#include <vector>
#include <stdexcept>
#include <samplerate.h>

class AudioResampler {
public:
    AudioResampler();
    ~AudioResampler();

    void init(int inputRate, int outputRate);

    void resample(const float* input, long inputFrames, std::vector<float>& output);

private:
    SRC_STATE* resampler_ = nullptr;
    SRC_DATA data_{};

    int inRate_  = 0;
    int outRate_ = 0;
};
