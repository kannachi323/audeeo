#include <iostream>

#include "audeeo/win32_window.h"
#include "audeeo/draw_ui.h"


int main() {
    Win32Window window(800, 200, "audeeo", "assets/icon64.png");
    GLFWwindow* glfw_window = window.getNativeWindow();

    DrawUI ui;
    ui.init(glfw_window);

    while (!glfwWindowShouldClose(glfw_window)) {
        window.prepare_frame();
        ui.start_frame();

        ui.draw_main_menu_bar();

        EngineMetrics metrics = { 240.0f };
        ui.draw_debug_stats(metrics);
    
        float vol;
        bool mute;
        ui.draw_sound_settings_bar(&vol, &mute);

        
        ImGuiIO& io = ImGui::GetIO();
        ImVec2 pos = ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f);
        ui.draw_text("Your translated text will appear here...", pos, (void*)&pos);

        ui.end_frame();

     

        window.present_frame();
        
    }
    return 0;
}