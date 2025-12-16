#pragma once
#include <queue>
#include <vector>
#include <mutex>
#include <string>
#include <condition_variable>

enum TextQueueType {
    SOURCE,
    TARGET
};

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



class TextQueue {
    public: 
        void Push(const std::string& text);
        bool Pop(std::string& out);
        void Stop();

    private:
        std::queue<std::string> queue_;
        std::mutex mu_;
        std::condition_variable cv_;
        bool stopped_ = false;
};
