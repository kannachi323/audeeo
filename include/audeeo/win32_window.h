#pragma once

#ifdef _WIN32
#define GLFW_EXPOSE_NATIVE_WIN32


#include "audeeo/window.h"
#include <GLFW/glfw3native.h>
#include <windows.h>
#include <windows.h>
#include <dwmapi.h>
#include <windowsx.h>

#include "audeeo/image_loader.h"


class Win32Window : public Window {
public:
    Win32Window(unsigned int width, unsigned int height, const std::string& title, const std::string& icon_path);
    ~Win32Window() override = default;

    HWND get_hwnd() const;
    void set_theme();
    void set_icon(const std::string& path);

private:
    void install_win32_hooks();

    static LRESULT CALLBACK win32_window_proc(
        HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam
    );

    static WNDPROC wnd_proc_;
    HWND hwnd_ = nullptr;
};

#endif
