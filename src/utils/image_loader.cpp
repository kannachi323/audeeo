// src/core/image_loader.cpp
#include "audeeo/image_loader.h"

#define STBI_STATIC               // Makes these functions private to THIS file
#define STB_IMAGE_IMPLEMENTATION  // Generates the code logic here
#include <stb_image.h>            // The header

unsigned char* load_image(const char* path, int* w, int* h, int* channels) {
    return stbi_load(path, w, h, channels, 4); // Force 4 channels (RGBA)
}

void free_image(unsigned char* pixels) {
    stbi_image_free(pixels);
}