#include "audeeo/text_renderer.h"
#include <iostream>
#include <stdexcept>
#include <algorithm>
#include <vector>

// --- UTF8CPP Library ---
#include <utf8.h> 

#include <ft2build.h>
#include FT_FREETYPE_H

// --- CONSTANTS ---
const unsigned int ATLAS_WIDTH = 4096; 

// --- HELPER: ATLAS SIZING ---
glm::ivec2 getAtlasSize(FT_Face face, unsigned long startChar, unsigned long endChar) {
    unsigned int max_h = 0;
    unsigned int row_w = 0;
    unsigned int row_h = 0;
    unsigned int padding = 1; 

    for (unsigned long c = startChar; c <= endChar; c++) {
        if (FT_Load_Char(face, c, FT_LOAD_RENDER)) continue;

        unsigned int glyph_w = face->glyph->bitmap.width + padding;
        unsigned int glyph_h = face->glyph->bitmap.rows + padding;

        if (row_w + glyph_w > ATLAS_WIDTH) {
            max_h += row_h;
            row_w = glyph_w;
            row_h = glyph_h;
        } else {
            row_w += glyph_w;
            row_h = std::max(row_h, glyph_h);
        }
    }
    max_h += row_h; 
    return glm::ivec2(ATLAS_WIDTH, max_h);
}

// --------------------------------------------------------------------------------
// PUBLIC INTERFACE
// --------------------------------------------------------------------------------

TextRenderer::TextRenderer(unsigned int windowWidth, unsigned int windowHeight,
                           const std::string& vsPath, const std::string& fsPath)
    : TextShader(vsPath.c_str(), fsPath.c_str()) 
{
    setupGLResources(); 

    glm::mat4 projection = glm::ortho(0.0f, (float)windowWidth, 0.0f, (float)windowHeight);
    TextShader.use();
    TextShader.setMat4("projection", projection);
}

TextRenderer::~TextRenderer() {
    glDeleteVertexArrays(1, &VAO);
    glDeleteBuffers(1, &VBO);
    
    // Clean up all generated textures
    for (GLuint tex : Textures) {
        glDeleteTextures(1, &tex);
    }
}

void TextRenderer::LoadFont(const std::string& fontPath, unsigned int fontSize, CharSet set) {
    FT_Library ft;
    if (FT_Init_FreeType(&ft)) {
        throw std::runtime_error("ERROR::FREETYPE: Could not init FreeType Library");
    }

    FT_Face face;
    if (FT_New_Face(ft, fontPath.c_str(), 0, &face)) {
        throw std::runtime_error("ERROR::FREETYPE: Failed to load font: " + fontPath);
    }
    
    FT_Set_Pixel_Sizes(face, 0, fontSize);

    switch (set) {
        case CharSet::Latin_ASCII:
            loadLatin(face);
            break;
        case CharSet::CJK_Unified_Ideographs:
            loadCJK(face);
            break;
    }

    FT_Done_Face(face);
    FT_Done_FreeType(ft);
}

// --------------------------------------------------------------------------------
// PRIVATE HELPERS
// --------------------------------------------------------------------------------

void TextRenderer::setupGLResources() {
    glGenVertexArrays(1, &VAO);
    glGenBuffers(1, &VBO);
    glBindVertexArray(VAO);
    glBindBuffer(GL_ARRAY_BUFFER, VBO);
    glBufferData(GL_ARRAY_BUFFER, sizeof(float) * 6 * 4, nullptr, GL_DYNAMIC_DRAW); 
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 4, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindVertexArray(0);
}

void TextRenderer::loadLatin(FT_Face face) {
    loadGlyphsToAtlas(face, 0, 127);
}

void TextRenderer::loadCJK(FT_Face face) {
    // 0x4E00 to 0x9FFF covers the main CJK block (~21,000 chars).
    // The atlas logic will handle resizing height as needed.
    loadGlyphsToAtlas(face, 0x4E00, 0x9FFF); 
}

void TextRenderer::loadGlyphsToAtlas(FT_Face face, unsigned long startChar, unsigned long endChar) {
    
    // 1. Calculate required texture dimensions
    glm::ivec2 atlasSize = getAtlasSize(face, startChar, endChar);
    unsigned int atlasW = atlasSize.x;
    unsigned int atlasH = atlasSize.y;
    
    std::cout << "Generating Atlas: " << atlasW << "x" << atlasH << " for range " << startChar << "-" << endChar << std::endl;

    // 2. GENERATE A NEW TEXTURE for this batch (Prevents overwriting previous fonts)
    GLuint newTexture;
    glGenTextures(1, &newTexture);
    Textures.push_back(newTexture); // Save ID for cleanup

    glBindTexture(GL_TEXTURE_2D, newTexture);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    
    // Allocate GPU memory
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RED, atlasW, atlasH, 0, GL_RED, GL_UNSIGNED_BYTE, nullptr); 
    
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    
    // 3. Populate
    unsigned int x_offset = 0;
    unsigned int y_offset = 0;
    unsigned int row_h = 0;
    unsigned int padding = 1;

    for (unsigned long c = startChar; c <= endChar; c++) {
        if (FT_Load_Char(face, c, FT_LOAD_RENDER)) continue;

        unsigned int glyph_w = face->glyph->bitmap.width;
        unsigned int glyph_h = face->glyph->bitmap.rows;

        // Wrap to next row if needed
        if (x_offset + glyph_w + padding > atlasW) {
            y_offset += row_h;
            row_h = 0;
            x_offset = 0;
        }

        glTexSubImage2D(GL_TEXTURE_2D, 0, x_offset, y_offset, glyph_w, glyph_h, GL_RED, GL_UNSIGNED_BYTE, face->glyph->bitmap.buffer);
        
        float u0 = (float)x_offset / atlasW;
        float v0 = (float)y_offset / atlasH;
        float u1 = (float)(x_offset + glyph_w) / atlasW;
        float v1 = (float)(y_offset + glyph_h) / atlasH;

        Character character = {
            glm::ivec2(glyph_w, glyph_h),
            glm::ivec2(face->glyph->bitmap_left, face->glyph->bitmap_top),
            (unsigned int)face->glyph->advance.x,
            glm::vec4(u0, v0, u1, v1),
            newTexture // Store the ID of this specific texture
        };
        Characters[c] = character;
        
        x_offset += glyph_w + padding;
        row_h = std::max(row_h, glyph_h + padding);
    }
    
    glBindTexture(GL_TEXTURE_2D, 0);
}

void TextRenderer::RenderText(const std::string& text, 
                              float x, float y, float scale, const glm::vec3& color) {
    
    TextShader.use();
    TextShader.setVec3("textColor", color.x, color.y, color.z);
    
    glActiveTexture(GL_TEXTURE0);
    glBindVertexArray(VAO);
    
    GLuint currentTextureID = 0; 

    // --- UTF8CPP ITERATION ---
    // We use pointers to iterate safely through the string
    auto it = text.begin();
    auto end = text.end();

    while (it != end) {
        unsigned long char_code = 0;
        
        try {
            // safely get the next codepoint
            char_code = utf8::next(it, end); 
        } catch (const utf8::exception& e) {
            // Skip invalid sequence if encountered
            continue; 
        }

        if (Characters.find(char_code) == Characters.end()) continue; 

        Character ch = Characters[char_code];

        // Only bind texture if it changed (optimization)
        if (ch.TextureID != currentTextureID) {
            glBindTexture(GL_TEXTURE_2D, ch.TextureID);
            currentTextureID = ch.TextureID;
        }

        float xpos = x + ch.Bearing.x * scale;
        float ypos = y - (ch.Size.y - ch.Bearing.y) * scale;

        float w = ch.Size.x * scale;
        float h = ch.Size.y * scale;

        float u0 = ch.UVCoords.x;
        float v0 = ch.UVCoords.y;
        float u1 = ch.UVCoords.z;
        float v1 = ch.UVCoords.w;

        float vertices[6][4] = {
            { xpos,     ypos + h,   u0, v0 },  
            { xpos,     ypos,       u0, v1 },  
            { xpos + w, ypos,       u1, v1 },  

            { xpos,     ypos + h,   u0, v0 },  
            { xpos + w, ypos,       u1, v1 },  
            { xpos + w, ypos + h,   u1, v0 }   
        };
        
        glBindBuffer(GL_ARRAY_BUFFER, VBO);
        glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(vertices), vertices); 
        glDrawArrays(GL_TRIANGLES, 0, 6);
        
        x += (ch.Advance >> 6) * scale;
    }

    glBindVertexArray(0);
    glBindTexture(GL_TEXTURE_2D, 0);
}