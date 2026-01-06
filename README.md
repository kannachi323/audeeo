# audeeo

Offline speech-to-text live subtitle generator. Real-time speech recognition and translation with a sleek GUI overlay for Windows.

![Project Screenshot](https://github.com/user-attachments/assets/970434ec-83ca-4e15-a525-e11d7e52894b)

## Features

- **Offline Processing**: No internet required for speech recognition and translation
- **Real-Time Subtitles**: Live subtitle overlay for system audio or microphone input
- **Multi-Language Support**: Chinese (Mandarin) to English translation out of the box
- **Minimal Resource Usage**: Lightweight C++ implementation with optimized audio processing
- **Customizable Overlay**: Configurable hotkeys and UI positioning
- **Low-Latency**: Engineered for minimal delay between speech and subtitle display

## Technical Stack

- **Speech Recognition**: [Vosk](https://alphacephei.com/vosk/) for offline speech-to-text
- **Machine Translation**: [CTranslate2](https://github.com/OpenNMT/CTranslate2) with [OpusMT](https://github.com/Helsinki-NLP/Opus-MT) models
- **Audio Processing**: PortAudio, libsamplerate, libfvad
- **Graphics**: OpenGL with ImGui for UI, GLFW for window management
- **Text Rendering**: FreeType
- **Build System**: CMake 3.10+
- **Language**: C++17

## Prerequisites

### System Requirements
- Windows 10 or later (64-bit)
- ~1GB disk space for models
- Audio input device (microphone or system audio routing)

### Build Requirements
- CMake 3.10 or higher
- C++17 compatible compiler (MSVC recommended)
- DEV_ROOT environment variable pointing to external dependencies directory

### Dependencies
The project requires pre-built libraries for:
- GLFW 3.4
- FreeType 2.14.1
- Vosk speech recognition
- PortAudio
- libsamplerate
- CTranslate2
- SentencePiece
- libfvad

These should be placed in the directory structure specified by your `DEV_ROOT` environment variable.

## Installation & Building

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/audeeo.git
cd audeeo
```

### 2. Download Models
The application requires pretrained models. Models are included in the `models/` directory:

- **Vosk Models** (Chinese and English):
  - `models/vosk-model-cn-0.22/` - Chinese speech recognition
  - `models/vosk-model-en-us-0.22/` - English speech recognition

- **Translation Models**:
  - `models/opus-mt-zh-en/` - Chinese to English translation

If models are missing, they can be downloaded from:
- [Vosk Models](https://alphacephei.com/vosk/models)
- [OpusMT Models](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)

### 3. Setup Dependencies
Configure the `DEV_ROOT` environment variable to point to your dependencies directory containing all required libraries.

### 4. Build with CMake
```bash
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

The compiled executable will be in `build/audeeo.exe`.

### 5. Configure
Edit `config/audeeo.conf` to customize hotkeys and settings:
```properties
EXIT=CTRL,Q
TOGGLE_OVERLAY=CTRL,X
```

## Usage

### Running the Application
```bash
./build/audeeo
```

The application will:
1. Load speech recognition and translation models
2. Create a minimal overlay window
3. Listen for speech input
4. Display real-time subtitles in the overlay

### Keyboard Controls
- **CTRL+Q**: Exit application
- **CTRL+X**: Toggle overlay visibility

### Input Sources
- **Microphone**: Direct microphone input for personal use
- **System Audio**: Route system audio through input device (requires audio loopback setup)

## Project Structure

```
audeeo/
├── src/
│   ├── main.cpp           # Application entry point
│   ├── core/              # Core processing modules
│   │   ├── speech_translator.cpp
│   │   ├── audio_processor.cpp
│   │   ├── text_translator.cpp
│   │   └── ...
│   ├── gui/               # GUI and rendering
│   │   ├── draw_ui.cpp
│   │   ├── win32_window.cpp
│   │   ├── text_renderer.cpp
│   │   └── ...
│   └── utils/             # Utility functions
│       └── image_loader.cpp
├── include/audeeo/        # Header files
├── cmake/                 # CMake configuration modules
├── models/                # Pretrained models directory
├── config/                # Configuration files
├── assets/                # UI assets and fonts
├── libs/                  # Prebuilt library files
└── translator/            # Python model download utilities
```

## Architecture

The application follows a modular architecture:

- **SpeechTranslator**: Main orchestrator coordinating audio processing and translation
- **AudioProcessor**: Handles real-time audio capture and processing
- **AudioText**: Converts audio streams to text using Vosk
- **TextTranslator**: Translates recognized text using CTranslate2
- **DrawUI**: Manages ImGui rendering and overlay display
- **Win32Window**: Handles Windows-specific window management

Components communicate through thread-safe queues for real-time processing without blocking.

## Configuration

### Keyboard Shortcuts
Edit `config/audeeo.conf`:
```properties
EXIT=CTRL,Q                    # Exit application
TOGGLE_OVERLAY=CTRL,X          # Show/hide subtitle overlay
```

### Model Selection
Modify `src/main.cpp` to change speech recognition or translation models:
```cpp
engine.init(
    "../models/vosk-model-cn-0.22",              // Speech recognition model
    "../models/opus-mt-zh-en",                   // Translation model
    "../models/opus-mt-zh-en/tokenizer/source.spm",
    "../models/opus-mt-zh-en/tokenizer/target.spm",
    callback
);
```

## Troubleshooting

### Application Won't Start
- Ensure all model files are present in `models/` directory
- Verify `DEV_ROOT` environment variable is correctly set
- Check that all DLL dependencies are accessible

### No Audio Input
- Verify audio device is working and selected in system settings
- For system audio capture, configure audio loopback using tools like VB-Audio Virtual Cable
- Check microphone permissions in Windows settings

### High CPU Usage
- Reduce audio sample rate by adjusting audio processing parameters
- Ensure system has sufficient free RAM for model loading

## Development

### Adding Support for New Languages
1. Download Vosk model for your language from [Vosk Models](https://alphacephei.com/vosk/models)
2. Download OpusMT translation model from [Hugging Face](https://huggingface.co/Helsinki-NLP)
3. Update model paths in `src/main.cpp`
4. Rebuild the application

### Contributing
We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes and test thoroughly
4. Submit a pull request with a clear description

## Performance Notes

- First run loads models into memory (~500MB for speech + translation)
- Speech recognition latency: ~100-200ms
- Translation latency: ~50-100ms
- Total end-to-end latency: ~200-400ms depending on system resources

## Known Limitations

- Requires Windows 10 or later
- Offline models limit accuracy compared to cloud-based services
- Single language pair (Chinese to English) by default
- Requires manual setup of dependencies

## License

This project is licensed under [LICENSE](LICENSE) - see the LICENSE file for details.

## Support & Documentation

- **Issues**: Report bugs and request features via [GitHub Issues](../../issues)
- **Discussions**: Join community discussions via [GitHub Discussions](../../discussions)

## Acknowledgments

- [Vosk](https://alphacephei.com/vosk/) for offline speech recognition
- [OpenNMT](https://opennmt.net/) for CTranslate2 translation framework
- [ImGui](https://github.com/ocornut/imgui) for the UI framework
- [Hugging Face](https://huggingface.co/) for model hosting

---

**Made with ❤️ for accessible, offline speech-to-text technology**
