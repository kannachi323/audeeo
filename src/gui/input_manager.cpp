#include "audeeo/input_manager.h"
#include <fstream>
#include <sstream>
#include <algorithm>
#include <iostream>


int InputManager::string_to_code(const std::string& key_name) {
    return name_to_code_.count(key_name) ? name_to_code_.at(key_name) : 0;
}

Action InputManager::string_to_action(const std::string& action_name) {
    if (action_name == "EXIT") return Action::EXIT;
    if (action_name == "TOGGLE_OVERLAY") return Action::TOGGLE_OVERLAY;
    return Action::NONE;
}


void InputManager::load_config(const std::string& path) {
    std::ifstream file(path);
    std::string line;
    while (std::getline(file, line)) {
        if (line.empty()) continue;
        parse_config_line(line);
    }
}

void InputManager::parse_config_line(const std::string& line) {
    size_t pos = line.find('=');
    if (pos == std::string::npos) return;

    std::string action_str = line.substr(0, pos);
    std::string keys_str = line.substr(pos + 1);

    Action action = string_to_action(action_str);
    if (action == Action::NONE) return;

    int packed_shortcut = 0;
    std::stringstream ss(keys_str);
    std::string segment;

    while (std::getline(ss, segment, ',')) {
        packed_shortcut |= string_to_code(segment);
    }

    shortcut_map_[action] = packed_shortcut;
}

void InputManager::handle_key_input(int key, int mods, int action) {
    // 1. Always update the persistent modifier mask
    current_mods_mask_ = 0;
    if (mods & 0x0002) current_mods_mask_ |= MOD_CTRL;
    if (mods & 0x0001) current_mods_mask_ |= MOD_SHIFT;
    if (mods & 0x0004) current_mods_mask_ |= MOD_ALT;

    // 2. If a key was released, we reset that action state and stop
    if (action == 0) { // GLFW_RELEASE
        return; 
    }

    // 3. Check shortcuts on PRESS or REPEAT
    for (auto const& [act, shortcut] : shortcut_map_) {
        // A shortcut is triggered if:
        // The bits for modifiers match AND the base key matches
        int required_mods = shortcut & 0xFFFF0000;
        int required_key  = shortcut & 0x0000FFFF;

        if (current_mods_mask_ == required_mods && key == required_key) {
            action_states_[act] = true; 
        }
    }
}

bool InputManager::is_triggered(Action action) {
    if (action_states_.count(action) && action_states_[action]) {
        action_states_[action] = false; // Reset "Latch" so the next tap can be detected
        return true;
    }
    return false;
}