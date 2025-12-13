#pragma once

#include <string>
#include <stdexcept>

#include <glad/glad.h>
#include <GLFW/glfw3.h>

class Window {
public:
    Window(unsigned int width, unsigned int height, const std::string& title);
    ~Window();

    bool shouldClose() const;
    
    void update() const;
    
    GLFWwindow* getGLFWwindow() const { return window_; }
    std::pair<int, int> getWindowSize() const;

private:
    GLFWwindow* window_;
    
    static void framebufferSizeCallback(GLFWwindow* window, int width, int height);

    void initGLFW();
    void initGLAD();

};