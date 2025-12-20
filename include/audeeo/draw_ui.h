#pragma once
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <vector>
#include <string>
#include <windows.h>
#include <shellapi.h>


class DrawUI {
public:
    void init(GLFWwindow* window);
    void shutdown();
    
    void start_frame();
    void end_frame();

    void draw_bottom_menu_bar(float* volume, bool* mute);
    void draw_audio_source_modal(bool* open_trigger);
    void draw_translation_text(const std::string& text);
    void draw_support_me();
};