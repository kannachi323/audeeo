#include <iostream>
#include <glm/glm.hpp>

#include <audeeo/window.h>
#include <audeeo/text_renderer.h>

int main() {
    try {
        // --- Initialization ---
        unsigned int WIDTH = 800;
        unsigned int HEIGHT = 600;

        // Note: Window sets up GLAD and the OpenGL context
        Window window = Window(WIDTH, HEIGHT, "audeeo");

        TextRenderer textRenderer(WIDTH, HEIGHT, "text.vs", "text.fs");
        // Load fonts (Latin and CJK)
        textRenderer.LoadFont("fonts/NotoSans-Regular.ttf", 48, CharSet::Latin_ASCII);
        textRenderer.LoadFont("fonts/NotoSansSC-Regular.ttf", 48, CharSet::CJK_Unified_Ideographs);

        // --- Main Render Loop ---
        while (!window.shouldClose()) {
            
            // 1. INPUT / LOGIC (Not needed yet)

            // 2. RENDERING
            
            // Clear the color buffer with 0.0 alpha for a transparent background
            glClearColor(0.0f, 0.0f, 0.0f, 0.0f); 
            glClear(GL_COLOR_BUFFER_BIT);
            
            // Render the Latin text
            textRenderer.RenderText("Hello World!", 
                                    50.0f, 
                                    (float)HEIGHT - 80.0f, // Position near the top
                                    1.0f, 
                                    glm::vec3(1.0f, 1.0f, 1.0f)); // White

            // Render the CJK text
            textRenderer.RenderText("测试 CJK 文本", 
                                    50.0f, 
                                    (float)HEIGHT - 160.0f, // Position below the first line
                                    1.0f, 
                                    glm::vec3(0.1f, 0.8f, 0.1f)); // Green
            
            // 3. SWAP BUFFERS and POLL EVENTS
            window.update(); 
        }
    } catch (const std::runtime_error& e) {
        std::cerr << "Runtime Error: " << e.what() << std::endl;
        return -1;
    }

    return 0;
}