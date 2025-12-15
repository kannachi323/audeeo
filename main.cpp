#include <iostream>
#include <glm/glm.hpp>

#include "audeeo/window.h"
#include "audeeo/text_renderer.h"
#include "audeeo/audio_text.h"
#include "audeeo/audio_processor.h"

int main() {
    try {
        unsigned int WIDTH = 800;
        unsigned int HEIGHT = 600;

        Window window = Window(WIDTH, HEIGHT, "audeeo");

       
        /*
        TextRenderer textRenderer(WIDTH, HEIGHT, "text.vs", "text.fs");
        textRenderer.LoadFont("fonts/NotoSans-Regular.ttf", 48, CharSet::Latin_ASCII);
        textRenderer.LoadFont("fonts/NotoSansSC-Regular.ttf", 48, CharSet::CJK_Unified_Ideographs);        
        */
       
        /* 
        AudioText audioText("../models/vosk-model-cn-0.22");
        audioText.start();
        */
        std::queue<AudioChunk> queue;
        std::mutex mutex;
        AudioProcessor audioProcessor(queue, mutex);

        audioProcessor.findLoopbackDevice();

        audioProcessor.start();

        
        

        while (!window.shouldClose()) {
            glClearColor(0.0f, 0.0f, 0.0f, 0.0f); 
            glClear(GL_COLOR_BUFFER_BIT);
            window.update(); 
        }
    } catch (const std::runtime_error& e) {
        std::cerr << "Runtime Error: " << e.what() << std::endl;
        return -1;
    }

    return 0;
}