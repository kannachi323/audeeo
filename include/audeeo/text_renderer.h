#ifndef TEXT_RENDERER_H
#define TEXT_RENDERER_H

#include <map>
#include <vector>
#include <string>
#include <glad/glad.h> 
#include <glm/glm.hpp>
#include "audeeo/shader.h"
#include <ft2build.h>
#include FT_FREETYPE_H


enum class CharSet {
    Latin_ASCII,
    CJK_Unified_Ideographs
};

struct Character {
    glm::ivec2 Size;
    glm::ivec2 Bearing;
    unsigned int Advance;
    glm::vec4 UVCoords;
    GLuint TextureID; // Store which texture this character lives in
};

class TextRenderer {
public:
    // Pass shader paths (optional, defaults to "text.vs"/"text.fs")
    TextRenderer(unsigned int windowWidth, unsigned int windowHeight, 
                 const std::string& vsPath = "text.vs", 
                 const std::string& fsPath = "text.fs");
    ~TextRenderer();
    
    void LoadFont(const std::string& fontPath, unsigned int fontSize, CharSet set);
    void RenderText(const std::string& text, float x, float y, float scale, const glm::vec3& color);

private:
    Shader TextShader;
    unsigned int VAO, VBO;
    std::vector<GLuint> Textures; // List of all managed atlas textures
    std::map<unsigned long, Character> Characters;

    void setupGLResources();
    void loadLatin(FT_Face face);
    void loadCJK(FT_Face face);
    void loadGlyphsToAtlas(FT_Face face, unsigned long startChar, unsigned long endChar);
};

#endif