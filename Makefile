CXX         = g++
CC          = gcc
TARGET      = audeeo
BUILD_DIR   = build


EXTERNAL_INCLUDE_DIR = include/external
INCLUDE_DIR = include
LIBS_DIR    = libs

CPP_SRCS = main.cpp \
           $(wildcard core/*.cpp) \
           $(wildcard gui/*.cpp)
C_SRCS   = $(wildcard gui/*.c)
SHADER_SRCS = gui/text.vs gui/text.fs 
FONT_SRCS = $(wildcard fonts/*.ttf)

FONTS = $(patsubst fonts/%,$(BUILD_DIR)/fonts/%,$(FONT_SRCS))

SHADERS = $(patsubst gui/%.vs,$(BUILD_DIR)/%.vs,$(filter %.vs,$(SHADER_SRCS))) \
          $(patsubst gui/%.fs,$(BUILD_DIR)/%.fs,$(filter %.fs,$(SHADER_SRCS)))
OBJS = $(patsubst %.cpp,$(BUILD_DIR)/%.o,$(CPP_SRCS)) \
       $(patsubst %.c,$(BUILD_DIR)/%.o,$(C_SRCS))

CXXFLAGS = -std=c++17 -Wall -Wextra -Wno-unused-parameter -g -I$(EXTERNAL_INCLUDE_DIR) -I$(INCLUDE_DIR)
CFLAGS   = -Wall -Wextra -g -I$(EXTERNAL_INCLUDE_DIR) -I$(INCLUDE_DIR)

LDFLAGS  = -L$(LIBS_DIR)

LIBS = -lglfw3 -lopengl32 -lgdi32 -luser32 -lkernel32 -lfreetype

.PHONY: all clean

all: $(BUILD_DIR) $(SHADERS) $(FONTS) $(BUILD_DIR)/$(TARGET)

$(BUILD_DIR)/fonts:
	mkdir -p $@

$(BUILD_DIR)/fonts/%: fonts/% | $(BUILD_DIR)/fonts
	cp $< $@

$(BUILD_DIR)/%.vs: gui/%.vs | $(BUILD_DIR)
	cp $< $@

$(BUILD_DIR)/%.fs: gui/%.fs | $(BUILD_DIR)
	cp $< $@

$(BUILD_DIR)/$(TARGET): $(OBJS) $(SHADERS) $(FONTS)
	$(CXX) $(OBJS) -o $@ $(LDFLAGS) $(LIBS)

$(BUILD_DIR)/%.o: %.cpp
	@mkdir -p $(@D)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/%.o: %.c
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

clean:
	rm -rf $(BUILD_DIR)
