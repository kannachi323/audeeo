#pragma once

#include <iostream>
#include <queue>
#include <mutex>
#include <condition_variable>


class AudioQueue {
public:
    AudioQueue();
    ~AudioQueue();

    void Push(float* audioChunk);
    float* Pop();
    bool IsEmpty();
    bool SetSampleCount(int count);
    int GetSampleCount();

private:
    //audio chunks are 32-bit floats stored in a thread-safe queue
    std::queue<float*> audioQueue_;
    std::mutex mu_;
    std::condition_variable cv_;
    int sampleCount;
};