#pragma once
#include <queue>
#include <vector>
#include <mutex>
#include <condition_variable>

class AudioQueue {
public:
    void Push(std::vector<int16_t>&& chunk);
    bool Pop(std::vector<int16_t>& out);
    void Stop();

private:
    std::queue<std::vector<int16_t>> queue_;
    std::mutex mu_;
    std::condition_variable cv_;
    bool stopped_ = false;
};
