#include "audeeo/draw_ui.h"

void DrawUI::init(GLFWwindow* window) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init("#version 130");
}

void DrawUI::shutdown() {
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
}

void DrawUI::start_frame() {
    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();
}

void DrawUI::end_frame() {
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

void DrawUI::draw_main_menu_bar() {
    if (ImGui::BeginMainMenuBar()) {
        if (ImGui::BeginMenu("File")) {
            if (ImGui::MenuItem("Exit", "Alt+F4")) { /* Handle exit */ }
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("View")) {
            if (ImGui::MenuItem("Sound Settings")) { /* Toggle bool here */ }
            ImGui::EndMenu();
        }
        ImGui::EndMainMenuBar();
    }
}
    void DrawUI::draw_sound_settings_bar(float* volume, bool* mute) {
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | 
                             ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse;

    ImGuiIO& io = ImGui::GetIO();
    float window_width = io.DisplaySize.x;
    float window_height = 50.0f;
   
    ImVec2 pos = ImVec2(0.0f, io.DisplaySize.y - window_height);

    ImGui::SetNextWindowPos(pos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(window_width, window_height));

    ImGui::Begin("##Sound Settings", nullptr, flags);

    ImGui::SameLine();
    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + 20.0f);

    ImGui::Checkbox("Mute All", mute);

    ImGui::SameLine();
    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + 20.0f);

    static bool trigger_audio_modal = false;

    if (ImGui::Button("Audeeo Settings")) {
        trigger_audio_modal = true;
    }

    draw_audio_source_modal(&trigger_audio_modal);

    ImGui::End();
}

void DrawUI::draw_debug_stats(const EngineMetrics& metrics) {
    ImGui::Begin("Performance");
    ImGui::Text("FPS: %.1f", metrics.fps);
    ImGui::End();
}


void DrawUI::draw_audio_source_modal(bool* open_trigger) {
    if (*open_trigger) {
        ImGui::OpenPopup("Adjust Audio Source");
        *open_trigger = false;
    }

    ImGui::SetNextWindowSize(ImVec2(300, 150), ImGuiCond_FirstUseEver);

    if (ImGui::BeginPopupModal("Adjust Audio Source", NULL, ImGuiWindowFlags_AlwaysAutoResize)) {
        
        static int selected_device = 0;
        const char* devices[] = { "Default System Device", "USB Microphone", "Line In (Realtek)", "Virtual Mixer" };

        ImGui::Text("Select your input hardware:");
        ImGui::Separator();

        if (ImGui::BeginCombo("##devices", devices[selected_device])) {
            for (int i = 0; i < IM_ARRAYSIZE(devices); i++) {
                bool is_selected = (selected_device == i);
                if (ImGui::Selectable(devices[i], is_selected)) {
                    selected_device = i;
                }
                if (is_selected) ImGui::SetItemDefaultFocus();
            }
            ImGui::EndCombo();
        }

        ImGui::Spacing();


        if (ImGui::Button("Apply", ImVec2(120, 0))) { 
            ImGui::CloseCurrentPopup(); 
        }
        ImGui::SameLine();
        if (ImGui::Button("Cancel", ImVec2(120, 0))) { 
            ImGui::CloseCurrentPopup(); 
        }

        ImGui::EndPopup();
    }
}

void DrawUI::draw_text(const std::string& text, ImVec2 pos, void *owner) {
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | 
                             ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse | 
                             ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoSavedSettings |
                             ImGuiWindowFlags_NoMouseInputs;
    ImGui::PushID(owner); 

    ImGui::SetNextWindowPos(pos, ImGuiCond_Once, ImVec2(0.5, 0.5));
    ImGui::Begin("##overlay", nullptr, flags);
    ImGui::Text(text.c_str());   
    ImGui::End();
    ImGui::PopID();
}
