#include "audeeo/audio_resampler.h"

AudioResampler::AudioResampler() {}

AudioResampler::~AudioResampler() {
    if (resampler_) {
        src_delete(resampler_);
        resampler_ = nullptr;
    }
}

void AudioResampler::init(int inputRate, int outputRate) {
    if (resampler_)
        throw std::runtime_error("Resampler already initialized");

    int err = 0;
    resampler_ = src_new(SRC_SINC_FASTEST, 1, &err);
    if (!resampler_)
        throw std::runtime_error(src_strerror(err));

    inRate_  = inputRate;
    outRate_ = outputRate;
}



void AudioResampler::resample(const float* input, long input_frames, std::vector<float>& output) {
    if (!resampler_)
        throw std::runtime_error("Resampler not initialized");

    long out_capacity =
        (long)((double)input_frames * outRate_ / inRate_) + 64;

    output.resize(out_capacity);

    
    data_.data_in       = input;
    data_.input_frames  = input_frames;
    data_.data_out      = output.data();
    data_.output_frames = out_capacity;
    data_.src_ratio     = (double)outRate_ / inRate_;
    data_.end_of_input  = 0;

    
    int err = src_process(resampler_, &data_);
    if (err)
        throw std::runtime_error(src_strerror(err));

    output.resize(data_.output_frames_gen);
}
