#pragma once

unsigned char* load_image(const char* path, int* w, int* h, int* channels);

void free_image(unsigned char* pixels);