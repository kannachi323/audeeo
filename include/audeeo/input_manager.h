#pragma once
#include <unordered_map>
#include <string>
#include <vector>

enum class Action {
    EXIT,
    TOGGLE_OVERLAY,
    NONE
};

enum Modifier {
    MOD_NONE  = 0,
    MOD_CTRL  = 1 << 16,
    MOD_SHIFT = 1 << 17,
    MOD_ALT   = 1 << 18
};

class InputManager {
public:
    InputManager() = default;

    void load_config(const std::string& path);
    
    // Call this from your GLFW key callback
    void handle_key_input(int key, int mods, int action);

    bool is_triggered(Action action);

private:
    std::unordered_map<Action, int> shortcut_map_;
    std::unordered_map<Action, bool> action_states_;
    int current_mods_mask_ = 0;
    

    void parse_config_line(const std::string& line);
    int string_to_code(const std::string& key_name);
    Action string_to_action(const std::string& action_name);

    inline static const std::unordered_map<std::string, int> name_to_code_ = {
        {"ESC", 256}, {"ENTER", 257}, {"SPACE", 32},
        {"CTRL", MOD_CTRL}, {"SHIFT", MOD_SHIFT}, {"ALT", MOD_ALT},
        {"S", 83}, {"Q", 81}, {"O", 79}, {"X", 88}
    };

};