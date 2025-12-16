#pragma once

#include <iostream>
#include <vector>
#include <ctranslate2/translator.h>

class TextTranslator { 
public:
    TextTranslator();
    ~TextTranslator();

    void init(const std::string& model_path);


private:

};