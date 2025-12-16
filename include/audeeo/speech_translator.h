#pragma once

#include "audeeo/text_translator.h"
#include "audeeo/audio_processor.h"
#include "audeeo/audio_text.h"

namespace audeeo {
    class SpeechTranslator {
        public:
            SpeechTranslator() = default;
            ~SpeechTranslator() = default;

            void init(
                const std::string& vosk_model_path,
                const std::string& ctranslate2_model_path,
                const std::string& encoder_model_path,
                const std::string& decoder_model_path
            );

            void run();
        
        private:
            AudioProcessor audioProcessor_;
            AudioText audioText_;
            TextTranslator textTranslator_;
            AudioQueue audioQueue_;
            TextQueue sourceQueue_;
            TextQueue targetQueue_;
    };
};
