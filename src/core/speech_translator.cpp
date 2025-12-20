#include "audeeo/speech_translator.h"
#include <iostream>


void audeeo::SpeechTranslator::init(
    const std::string& vosk_model_path,
    const std::string& ctranslate2_model_path,
    const std::string& encoder_model_path,
    const std::string& decoder_model_path,
    OutputCallback callback
) {

  
    if (callback == nullptr) {
        throw std::runtime_error("Output callback cannot be null");
    }
    callback_ = std::move(callback);

    audioProcessor_.Init();
    audioProcessor_.LoadAudioQueue(&audioQueue_);

    audioText_.Init(vosk_model_path);
    audioText_.LoadAudioQueue(&audioQueue_);
    audioText_.LoadTextQueue(&sourceQueue_);

    textTranslator_.init(ctranslate2_model_path);
    textTranslator_.initEncoder(encoder_model_path);
    textTranslator_.initDecoder(decoder_model_path);
    textTranslator_.LoadTextQueue(&sourceQueue_, SOURCE);
    textTranslator_.LoadTextQueue(&targetQueue_, TARGET);
}

void audeeo::SpeechTranslator::run() {
    std::thread audioThread(&AudioProcessor::Start, &audioProcessor_);
    std::thread textThread(&AudioText::Start, &audioText_);
    std::thread translationThread(&TextTranslator::Start, &textTranslator_);
    callback_("Ready for translation...");

    std::string output_text;
    while (targetQueue_.Pop(output_text)) {
        callback_(output_text);
    }
    
}

void audeeo::SpeechTranslator::stop() {
    //close audio thread
    //close text thread
    //close translation thread
    running_ = false;
}