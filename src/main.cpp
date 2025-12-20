#include <iostream>

#include "audeeo/win32_window.h"
#include "audeeo/draw_ui.h"
#include "audeeo/speech_translator.h"


int main() {
    SetConsoleOutputCP(CP_UTF8);
    float vol;
    bool mute;


    

    std::mutex m;
    std::string text = "Loading all resources...";
    OutputCallback callback = [&](const std::string& s) {
        std::lock_guard<std::mutex> lock(m);
        text = s;
    };

    std::thread engineThread([callback]() {
        try {
            audeeo::SpeechTranslator engine;
            engine.init(
                "../models/vosk-model-cn-0.22",
                "../models/opus-mt-zh-en",
                "../models/opus-mt-zh-en/tokenizer/source.spm",
                "../models/opus-mt-zh-en/tokenizer/target.spm",
                callback
            );
            engine.run(); 
        } catch (const std::exception& e) {
            std::cerr << "Error running SpeechTranslator: " << e.what() << std::endl;
        }
    });
    
    
    Win32Window window(800, 200, "audeeo", "assets/icon64.png");
    GLFWwindow* glfw_window = window.getNativeWindow();

    DrawUI ui;
    ui.init(glfw_window);

    
    while (!glfwWindowShouldClose(glfw_window)) {
        window.prepare_frame();
        ui.start_frame();

      

        ui.draw_bottom_menu_bar(&vol, &mute);
        ui.draw_translation_text(text);
        ui.draw_support_me();

        ui.end_frame();

     

        window.present_frame();
        
    }

    engineThread.join();
    return 0;
}