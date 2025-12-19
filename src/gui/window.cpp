#include "audeeo/window.h"
#include <iostream>

Window::Window(unsigned int width, unsigned int height, const std::string& title) {
    initGLFW();
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

    window_ = glfwCreateWindow(width, height, title.c_str(), nullptr, nullptr);
    if (!window_) {
        std::cerr << "Failed to create GLFW window\n";
        glfwTerminate();
        return;
    }

    glfwMakeContextCurrent(window_);
    initGLAD();

    glfwSetWindowUserPointer(window_, this); 
    glfwSetFramebufferSizeCallback(window_, Window::framebufferSizeCallback);
    glfwSetKeyCallback(window_, Window::key_callback);

    init_input_manager();
}

Window::~Window() {
    if (window_) glfwDestroyWindow(window_);
    glfwTerminate();
}

bool Window::shouldClose() const {
    return glfwWindowShouldClose(window_);
}

void Window::prepare_frame() const {
    glfwPollEvents(); // Get input first so UI knows where mouse is
    glClearColor(0.1f, 0.1f, 0.1f, 1.0f); 
    glClear(GL_COLOR_BUFFER_BIT);
}

void Window::present_frame() const {
    glfwSwapBuffers(window_);
}

std::pair<int, int> Window::getWindowSize() const {
    int width, height;
    glfwGetWindowSize(window_, &width, &height);
    return {width, height};
}

void Window::setOverlayMode(bool enabled) {
    if (enabled) {
        // Overlay: transparent + always on top
        glfwSetWindowAttrib(window_, GLFW_DECORATED, GLFW_FALSE);
        glfwSetWindowAttrib(window_, GLFW_FLOATING, GLFW_TRUE);

        // Enable transparent framebuffer
        glfwSetWindowAttrib(window_, GLFW_TRANSPARENT_FRAMEBUFFER, GLFW_TRUE);

    } else {
        // Config: opaque + normal window
        glfwSetWindowAttrib(window_, GLFW_DECORATED, GLFW_TRUE);
        glfwSetWindowAttrib(window_, GLFW_FLOATING, GLFW_FALSE);

        // Disable transparent framebuffer for smooth resizing
        glfwSetWindowAttrib(window_, GLFW_TRANSPARENT_FRAMEBUFFER, GLFW_FALSE);
    }
}

void Window::initGLFW() {
    if (!glfwInit()) {
        std::cerr << "Failed to initialize GLFW\n";
    }
}

void Window::initGLAD() {
    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cerr << "Failed to initialize GLAD\n";
    }
}

void Window::init_input_manager() {
    input_manager_.load_config("config/audeeo.conf");
}

void Window::framebufferSizeCallback(GLFWwindow* window, int width, int height) {
    glViewport(0, 0, width, height);
}

void Window::key_callback(GLFWwindow* window, int key, int scancode, int action, int mods) {
    Window* instance = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (instance) {
        instance->input_manager_.handle_key_input(key, mods, action);
    }
}