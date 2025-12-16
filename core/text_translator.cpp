
#include <audeeo/text_translator.h>

TextTranslator::TextTranslator() {
    // Constructor implementation (if needed)
}

TextTranslator::~TextTranslator() {
    // Destructor implementation (if needed)
}

void TextTranslator::init(const std::string& model_path) {
    ctranslate2::Translator translator("ende_ctranslate2/", ctranslate2::Device::CPU);

    const std::vector<std::vector<std::string>> batch = {{"▁H", "ello", "▁world", "!"}};
    const std::vector<ctranslate2::TranslationResult> results = translator.translate_batch(batch);

    for (const auto& token : results[0].output())
        std::cout << token << ' ';
    std::cout << std::endl;
}

