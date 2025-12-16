#include <iostream>
#include <glm/glm.hpp>
#include "audeeo/speech_translator.h"


int main() {
    
    try {             
        SetConsoleOutputCP(CP_UTF8);
        audeeo::SpeechTranslator engine;
        engine.init(
            "../models/vosk-model-cn-0.22",
            "../models/opus-mt-zh-en",
            "../models/opus-mt-zh-en/tokenizer/source.spm",
            "../models/opus-mt-zh-en/tokenizer/target.spm"
        );

        engine.run();

    } catch (const std::runtime_error& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}