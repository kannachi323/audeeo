#ifdef _WIN32

#include "audeeo/win32_window.h"

WNDPROC Win32Window::wnd_proc_ = nullptr;

Win32Window::Win32Window(unsigned int width, unsigned int height, const std::string& title, const std::string& icon_path) : Window(width, height, title) {
    hwnd_ = glfwGetWin32Window(window_);
    set_theme();
    set_icon(icon_path);
    install_win32_hooks();
}

HWND Win32Window::get_hwnd() const {
    return hwnd_;
}

void Win32Window::set_icon(const std::string& path) {
    GLFWimage images[1]; 
    int channels = 4;

    images[0].pixels = load_image(path.c_str(), &images[0].width, &images[0].height, &channels); 

    if (images[0].pixels) {
        glfwSetWindowIcon(window_, 1, images);
    }

    free_image(images[0].pixels);
}

void Win32Window::set_theme() {
    BOOL dark = TRUE;
    DwmSetWindowAttribute(
        hwnd_,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
        &dark,
        sizeof(dark)
    );

    COLORREF bg   = RGB(0, 0, 0);
    COLORREF text = RGB(255, 255, 255);

    DwmSetWindowAttribute(hwnd_, DWMWA_CAPTION_COLOR, &bg, sizeof(bg));
    DwmSetWindowAttribute(hwnd_, DWMWA_TEXT_COLOR, &text, sizeof(text));
}

void Win32Window::install_win32_hooks() {
    wnd_proc_ = reinterpret_cast<WNDPROC>(
        SetWindowLongPtr(
            hwnd_,
            GWLP_WNDPROC,
            reinterpret_cast<LONG_PTR>(win32_window_proc)
        )
    );
}

LRESULT CALLBACK Win32Window::win32_window_proc(
    HWND hwnd,
    UINT msg,
    WPARAM wParam,
    LPARAM lParam
) {
    switch (msg) {
    case WM_NCHITTEST: {
        LRESULT hit = CallWindowProc(wnd_proc_, hwnd, msg, wParam, lParam);

        if (hit == HTCLIENT) {
            const int border = 8;
            POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
            RECT rc;

            GetClientRect(hwnd, &rc);
            ScreenToClient(hwnd, &pt);

            if (pt.y < border) return HTTOP;
            if (pt.y > rc.bottom - border) return HTBOTTOM;
            if (pt.x < border) return HTLEFT;
            if (pt.x > rc.right - border) return HTRIGHT;
        }
        return hit;
    }
    }

    return CallWindowProc(wnd_proc_, hwnd, msg, wParam, lParam);
}

#endif