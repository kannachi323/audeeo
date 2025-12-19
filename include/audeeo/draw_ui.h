#pragma once
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <vector>
#include <string>

struct EngineMetrics {
    float fps;
};

class DrawUI {
public:
    void init(GLFWwindow* window);
    void shutdown();
    
    void start_frame();
    void end_frame();

    void draw_main_menu_bar();
    void draw_sound_settings_bar(float* volume, bool* mute);
    void draw_debug_stats(const EngineMetrics& metrics);
    void draw_audio_source_modal(bool* open_trigger);
    void draw_text(const std::string& text, ImVec2 pos, void* owner);
};