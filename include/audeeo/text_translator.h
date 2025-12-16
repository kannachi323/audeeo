#pragma once

#include <iostream>
#include <vector>
#include <ctranslate2/translator.h>
#include <sentencepiece_processor.h>
#include "audeeo/queue.h"

class TextTranslator { 
public:
    TextTranslator() = default;
    ~TextTranslator() = default;

    void init(const std::string& model_path);
    void initEncoder(const std::string& model_path);
    void initDecoder(const std::string& model_path);
    void tokenizeText(const std::string input_text, std::vector<std::string>& tokens);
    void detokenizeText(const std::vector<std::string> tokens, std::string& output_text);
    void translateText(const std::string input_text, std::string& output_text);
    void LoadTextQueue(TextQueue* queue, TextQueueType type);
    void Start();


private:
    std::unique_ptr<ctranslate2::Translator> translator_;
    sentencepiece::SentencePieceProcessor encoder_;
    sentencepiece::SentencePieceProcessor decoder_;
    TextQueue* sourceQueue_ = nullptr;
    TextQueue* targetQueue_ = nullptr;
};