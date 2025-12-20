#include "audeeo/draw_ui.h"

void DrawUI::init(GLFWwindow* window) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init("#version 130");
    
 
    ImFontConfig config;
    config.MergeMode = true;
    config.PixelSnapH = true;
    
    ImGuiIO& io = ImGui::GetIO();
    io.Fonts->AddFontFromFileTTF("fonts/NotoSans-Regular.ttf", 18.0f);
    io.Fonts->AddFontFromFileTTF("C:/Windows/Fonts/msyh.ttc", 32.0f, &config, io.Fonts->GetGlyphRangesChineseFull());
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

void DrawUI::draw_bottom_menu_bar(float* volume, bool* mute) {
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | 
                             ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse;

    ImGuiIO& io = ImGui::GetIO();
    float window_width = io.DisplaySize.x;
    float window_height = 40.0f; // Increased slightly for better breathing room
   
    ImVec2 pos = ImVec2(0.0f, io.DisplaySize.y - window_height);

    ImGui::SetNextWindowPos(pos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(window_width, window_height));

    // Remove window padding to have full control over centering
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 0.0f)); 
    
    ImGui::Begin("##Sound Settings", nullptr, flags);

    // --- Vertical Centering Logic ---
    float item_height = ImGui::GetFrameHeight(); // Standard height of buttons/checkboxes
    float vertical_padding = (window_height - item_height) * 0.5f;
    ImGui::SetCursorPosY(vertical_padding);
    // --------------------------------

    // Start horizontal layout
    ImGui::Indent(10.0f); // Small left margin

    ImGui::Checkbox("Mute", mute);

    ImGui::SameLine(0, 20.0f); // 20px spacing

    static bool trigger_audio_modal = false;
    if (ImGui::Button("Audeeo Properties")) {
        trigger_audio_modal = true;
    }

    draw_audio_source_modal(&trigger_audio_modal);

    ImGui::End();
    ImGui::PopStyleVar(); // Pop WindowPadding
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

void DrawUI::draw_support_me() {
    // 1. Setup the Link Label with Heart
    // Note: u8"\u2764" is the Unicode for a heart. 
    const char* label = u8"Support Me \u2764"; 
    static bool open_linktree = false;

    // 2. Style as Hyperlink
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.4f, 0.7f, 1.0f, 1.0f)); // Light blue
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0,0,0,0));            // Transparent background
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0,0,0,0));     // Transparent hover
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0,0,0,0));      // Transparent click

    if (ImGui::Button(label)) {
        open_linktree = true; // Trigger the modal
    }

    // 3. Underline & Cursor Logic
    if (ImGui::IsItemHovered()) {
        ImVec2 line_start = ImGui::GetItemRectMin();
        line_start.y = ImGui::GetItemRectMax().y - 1.0f;
        ImVec2 line_end = ImGui::GetItemRectMax();
        line_end.y = ImGui::GetItemRectMax().y - 1.0f;
        ImGui::GetWindowDrawList()->AddLine(line_start, line_end, ImGui::GetColorU32(ImGuiCol_Text));
        ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
    }
    ImGui::PopStyleColor(4);

    // 4. THE MODAL POPUP
    if (open_linktree) {
        ImGui::OpenPopup("Support Links");
        open_linktree = false; 
    }

    // Center the modal
    ImVec2 center = ImGui::GetMainViewport()->GetCenter();
    ImGui::SetNextWindowPos(center, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));

    if (ImGui::BeginPopupModal("Support Links", NULL, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("Choose a platform:");
        ImGui::Separator();
        
        if (ImGui::Button("Buy Me a Coffee", ImVec2(200, 0))) {
            ShellExecuteA(NULL, "open", "https://buymeacoffee.com/yourname", NULL, NULL, SW_SHOWNORMAL);
        }
        if (ImGui::Button("Patreon", ImVec2(200, 0))) {
            ShellExecuteA(NULL, "open", "https://patreon.com/yourname", NULL, NULL, SW_SHOWNORMAL);
        }
        if (ImGui::Button("GitHub Sponsors", ImVec2(200, 0))) {
            ShellExecuteA(NULL, "open", "https://github.com/sponsors/yourname", NULL, NULL, SW_SHOWNORMAL);
        }

        ImGui::Spacing();
        ImGui::Separator();
        if (ImGui::Button("Close", ImVec2(200, 0))) { 
            ImGui::CloseCurrentPopup(); 
        }

        ImGui::EndPopup();
    }
}


void DrawUI::draw_translation_text(const std::string& text) {
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | 
                             ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse | 
                             ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoSavedSettings |
                             ImGuiWindowFlags_NoMouseInputs; 
    ImGuiIO& io = ImGui::GetIO();

    float window_width = ImGui::CalcTextSize(text.c_str()).x + 20.0f;
    float window_height = ImGui::CalcTextSize(text.c_str()).y + 20.0f;
    ImVec2 pos = ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.3f);

    ImGui::SetNextWindowPos(pos, ImGuiCond_Always, ImVec2(0.5, 0.5));
    ImGui::SetNextWindowSize(ImVec2(window_width, window_height));
    ImGui::Begin("##translation_text", nullptr, flags);
    ImGui::Text(text.c_str());   
    ImGui::End();
}
