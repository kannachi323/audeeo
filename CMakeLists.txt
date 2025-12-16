cmake_minimum_required(VERSION 3.10)

project(audeeo LANGUAGES CXX C VERSION 1.0)

set(TARGET audeeo) # ADD THIS LINE TO DEFINE THE TARGET NAME

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/build)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)
set(CMAKE_CXX_EXTENSIONS OFF)

add_compile_options(-Wall -Wextra -Wno-unused-parameter -g)

find_path(DEV_ROOT_PATH NAMES freetype/include/ft2build.h
    PATHS ENV DEV_ROOT
    DOC "Path to your development libraries root (where freetype, glfw are installed).")

if(NOT DEV_ROOT_PATH)
    message(FATAL_ERROR "DEV_ROOT_PATH not found. Please set the DEV_ROOT environment variable or specify it manually via -DDEV_ROOT_PATH=/path/.")
endif()

message(STATUS "External dependencies root found at: ${DEV_ROOT_PATH}")

set(LOCAL_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/include)

file(GLOB CPP_SRCS "main.cpp" "core/*.cpp" "gui/*.cpp")
file(GLOB C_SRCS "*.c")

set(ALL_SOURCES ${CPP_SRCS} ${C_SRCS})

file(GLOB SHADER_SRCS "gui/*.vs" "gui/*.fs")
file(GLOB FONT_SRCS "fonts/*.ttf")
file(GLOB RUNTIME_SRCS "libs/*.dll")

add_executable(${TARGET} ${ALL_SOURCES})

target_include_directories(${TARGET} PUBLIC
    ${LOCAL_INCLUDE_DIR}
    ${DEV_ROOT_PATH}
    ${DEV_ROOT_PATH}/freetype-2.14.1/include
    ${DEV_ROOT_PATH}/glfw-3.4/include
    ${DEV_ROOT_PATH}/utfcpp/include
    ${DEV_ROOT_PATH}/portaudio/include
    ${DEV_ROOT_PATH}/libsamplerate/include
    ${DEV_ROOT_PATH}/CTranslate2/include
    ${DEV_ROOT_PATH}/sentencepiece/src
)

set(LOCAL_LIBS_DIR ${CMAKE_SOURCE_DIR}/libs)

target_link_libraries(${TARGET} PUBLIC
    ${LOCAL_LIBS_DIR}/libglfw3.a
    ${LOCAL_LIBS_DIR}/libfreetype.a
    ${LOCAL_LIBS_DIR}/libvosk.lib
    ${LOCAL_LIBS_DIR}/libportaudio.dll.a
    ${LOCAL_LIBS_DIR}/libsamplerate.a
    ${LOCAL_LIBS_DIR}/libctranslate2.dll.a
    ${LOCAL_LIBS_DIR}/libsentencepiece.a

    opengl32
    gdi32
    user32
    kernel32
    ole32
    uuid
    winmm
    ksguid
)

set(RES_DEST_DIR ${CMAKE_RUNTIME_OUTPUT_DIRECTORY})
set(FONT_DEST_DIR ${RES_DEST_DIR}/fonts)

add_custom_command(
    TARGET ${TARGET} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy ${SHADER_SRCS} ${RES_DEST_DIR}
    COMMAND ${CMAKE_COMMAND} -E copy ${RUNTIME_SRCS} ${RES_DEST_DIR}
    COMMAND ${CMAKE_COMMAND} -E make_directory ${FONT_DEST_DIR}
    COMMAND ${CMAKE_COMMAND} -E copy ${FONT_SRCS} ${FONT_DEST_DIR}
)