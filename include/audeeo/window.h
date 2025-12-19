#pragma once

#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <string>
#include <utility>

#include "audeeo/input_manager.h"

class Window {
public:
    Window(unsigned int width, unsigned int height, const std::string& title);
    virtual ~Window();

    void init_input_manager();

    bool shouldClose() const;
    void prepare_frame() const;
    void present_frame() const;
    
    std::pair<int, int> getWindowSize() const;

    void setOverlayMode(bool enabled);
    GLFWwindow* getNativeWindow() const { return window_; }
    InputManager* get_input_manager() { return &input_manager_; }

protected:
    void initGLFW();
    void initGLAD();
    static void framebufferSizeCallback(GLFWwindow* window, int width, int height);
    static void key_callback(GLFWwindow* window, int key, int scancode, int action, int mods);

    GLFWwindow* window_;  
    InputManager input_manager_;
};
