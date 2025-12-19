#include <audeeo/queue.h>

void AudioQueue::Push(std::vector<int16_t>&& chunk) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        queue_.push(chunk);
    }
    cv_.notify_one();
}

bool AudioQueue::Pop(std::vector<int16_t>& out) {
    std::unique_lock<std::mutex> lock(mu_);
    cv_.wait(lock, [&]() {
        return stopped_ || !queue_.empty();
    });

    if (queue_.empty())
        return false;

    out = std::move(queue_.front());
    queue_.pop();
    return true;
}

void AudioQueue::Stop() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        stopped_ = true;
    }
    cv_.notify_all();
}

void TextQueue::Push(const std::string& text) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        queue_.push(text);
    }
    cv_.notify_one();
}

bool TextQueue::Pop(std::string& out) {
    std::unique_lock<std::mutex> lock(mu_);
    cv_.wait(lock, [&]() {
        return stopped_ || !queue_.empty();
    });

    if (queue_.empty())
        return false;

    out = queue_.front();
    queue_.pop();
    return true;
}

void TextQueue::Stop() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        stopped_ = true;
    }
    cv_.notify_all();
}
