
#include <audeeo/text_translator.h>

void TextTranslator::init(const std::string& model_path) {
    try {
        translator_ = std::make_unique<ctranslate2::Translator>(
            model_path, ctranslate2::Device::CPU
        );
    } catch (const std::exception& e) {
        std::cerr << "Failed to load CTranslate2 model: " << e.what() << std::endl;
        throw std::runtime_error("Failed to load CTranslate2 model");
    }
}

void TextTranslator::initEncoder(const std::string& model_path) {
    auto status = encoder_.Load(model_path);
    if (!status.ok()) {
        throw std::runtime_error(
            "Failed to load encoder model: " + status.ToString()
        );
    }
}

void TextTranslator::initDecoder(const std::string& model_path) {
    auto status = decoder_.Load(model_path);
    if (!status.ok()) {
        throw std::runtime_error(
            "Failed to load decoder model: " + status.ToString()
        );
    }
}

void TextTranslator::tokenizeText(const std::string input_text, std::vector<std::string>& tokens) {
    tokens.clear();
    auto status = encoder_.Encode(input_text, &tokens);
    if (!status.ok()) {
        throw std::runtime_error(
            "Failed to tokenize text: " + status.ToString());
    }
}

void TextTranslator::detokenizeText(const std::vector<std::string> tokens, std::string& output_text) {
    output_text.clear();
    auto status = decoder_.Decode(tokens, &output_text);
    if (!status.ok()) {
        throw std::runtime_error(
            "Failed to detokenize text: " + status.ToString());
    }
}

void TextTranslator::translateText(const std::string input_text, std::string& output_text) {
    std::vector<std::string> tokens;
    tokenizeText(input_text, tokens);
    tokens.push_back("</s>");


    std::vector<std::vector<std::string>> batch = { tokens };
    ctranslate2::TranslationOptions options;

    const std::vector<ctranslate2::TranslationResult> results = translator_->translate_batch(batch, options);

    detokenizeText(results[0].output(), output_text);    
}

void TextTranslator::LoadTextQueue(TextQueue* queue, TextQueueType type) {
    if (type == SOURCE) {
        sourceQueue_ = queue;
    } else if (type == TARGET) {
        targetQueue_ = queue;
    } else {
        throw std::runtime_error("Invalid TextQueueType");
    }
}

void TextTranslator::Start() {
    if (!sourceQueue_ || !targetQueue_) {
        throw std::runtime_error("Text queues not loaded");
    }

    std::string input_text;
    while (sourceQueue_->Pop(input_text)) {
        std::cout << "Source Text: " << input_text << std::endl;
        std::string output_text;
        translateText(input_text, output_text);
        targetQueue_->Push(output_text);
    }
}
