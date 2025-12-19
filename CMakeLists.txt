cmake_minimum_required(VERSION 3.10)
project(audeeo LANGUAGES CXX C VERSION 1.0)

set(TARGET audeeo)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/build)
set(CMAKE_CXX_STANDARD 17)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")

include(setup_deps)  # Sets EXTERNAL_INCLUDE_DIRS and EXTERNAL_LIBS
include(setup_imgui)        # Sets IMGUI_SOURCES and IMGUI_INCLUDE_DIRS
include(setup_assets)     # Defines copy_resources() function

file(GLOB CPP_SRCS "src/main.cpp" "src/core/*.cpp" "src/gui/*.cpp" "src/utils/*.cpp")
file(GLOB C_SRCS "src/*.c")

add_executable(${TARGET} ${CPP_SRCS} ${C_SRCS} ${IMGUI_SOURCES})

target_include_directories(${TARGET} PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${IMGUI_INCLUDE_DIRS}
    ${EXTERNAL_INCLUDE_DIRS}
)

target_link_libraries(${TARGET} PUBLIC ${EXTERNAL_LIBS})

setup_assets(${TARGET})