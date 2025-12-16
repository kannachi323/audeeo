#include "audeeo/speech_translator.h"
#include <iostream>


void audeeo::SpeechTranslator::init(
    const std::string& vosk_model_path,
    const std::string& ctranslate2_model_path,
    const std::string& encoder_model_path,
    const std::string& decoder_model_path
) {

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
    
    std::string output_text;
    while (targetQueue_.Pop(output_text)) {
        std::cout << "Output Text: " << output_text << std::endl;
    }
}
