#include <iostream>
#include <glm/glm.hpp>
#include <mutex>
#include <condition_variable>

#include "audeeo/window.h"
#include "audeeo/text_renderer.h"
#include "audeeo/audio_text.h"
#include "audeeo/audio_processor.h"
#include "audeeo/audio_queue.h"
#include "audeeo/text_translator.h"

#include <sentencepiece_processor.h>

struct SubtitleEngine {
    AudioProcessor audioProcessor;
    AudioText audioText;
    TextTranslator translator;
};

int main() {
    SetConsoleOutputCP(CP_UTF8);
    AudioQueue audioQueue;

    SubtitleEngine engine;
    /*
    
    
    
    engine.audioText.Init("../models/vosk-model-cn-0.22");
    engine.audioProcessor.Init();

    engine.audioText.LoadAudioQueue(&audioQueue);
    engine.audioProcessor.LoadAudioQueue(&audioQueue);

    */

    engine.translator.init("../models/opus-mt-zh-en");

    try {     
        //engine.audioProcessor.ListAudioDevices();
        //std::thread audioThread(&AudioProcessor::Start, &engine.audioProcessor);
        
        //std::thread textThread(&AudioText::Start, &engine.audioText);

        //std::cout << "Audio and Text threads started. Waiting for them to finish (or close the window)..." << std::endl;

        //audioThread.join();
        //textThread.join();

    } catch (const std::runtime_error& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}