#include <iostream>
#include <glm/glm.hpp>
#include <mutex>
#include <condition_variable>

#include "audeeo/window.h"
#include "audeeo/text_renderer.h"
#include "audeeo/audio_text.h"
#include "audeeo/audio_processor.h"

struct AudioChunkQueue {
    //audio chunks are 32-bit floats stored in a thread-safe queue
    std::queue<float*> audioChunks;
    std::mutex mu;
    std::condition_variable cv;
};

struct TranslationEngine {
    AudioProcessor audioProcessor;
    AudioText audioText{"models/vosk-model-small-en-us-0.15"};
    Translator translator{"models/opus-mt-zn-en"};
    AudioQueue audioQueue;
};

int main() {
    TranslationEngine translationEngine;

    try {     
        translationEngine.audioProcessor.Init(); 
        translationEngine.audioText.Start();
        audioProcessor.ListAudioDevices();
        std::thread(&AudioProcessor::Start, this).detach();
        
    } catch (const std::runtime_error& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}