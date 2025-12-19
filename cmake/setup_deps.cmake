# cmake/setup_deps.cmake

if(NOT DEFINED ENV{DEV_ROOT})
    message(FATAL_ERROR "DEV_ROOT_PATH not found! Set DEV_ROOT env var.")
endif()

set(DEV_ROOT_PATH $ENV{DEV_ROOT})
message(STATUS "DEV_ROOT_PATH = ${DEV_ROOT_PATH}")


message(STATUS "Dependencies found at: ${DEV_ROOT_PATH}")

set(EXTERNAL_INCLUDE_DIRS
    ${DEV_ROOT_PATH}
    ${DEV_ROOT_PATH}/freetype-2.14.1/include
    ${DEV_ROOT_PATH}/glfw-3.4/include
    ${DEV_ROOT_PATH}/utfcpp/include
    ${DEV_ROOT_PATH}/libsamplerate/include
    ${DEV_ROOT_PATH}/CTranslate2/include
    ${DEV_ROOT_PATH}/sentencepiece/src
    ${DEV_ROOT_PATH}/json/include
    ${DEV_ROOT_PATH}/libfvad/include
    ${DEV_ROOT_PATH}/AudioFile
    ${DEV_ROOT_PATH}/stb
)

set(EXTERNAL_LIBS
    ${CMAKE_SOURCE_DIR}/libs/libglfw3.a
    ${CMAKE_SOURCE_DIR}/libs/libfreetype.a
    ${CMAKE_SOURCE_DIR}/libs/libvosk.lib
    ${CMAKE_SOURCE_DIR}/libs/libportaudio.dll.a
    ${CMAKE_SOURCE_DIR}/libs/libsamplerate.a
    ${CMAKE_SOURCE_DIR}/libs/libctranslate2.dll.a
    ${CMAKE_SOURCE_DIR}/libs/libsentencepiece.a
    ${CMAKE_SOURCE_DIR}/libs/libfvad.a
    

    opengl32 gdi32 user32 kernel32 ole32 uuid winmm ksguid dwmapi
)