# Ktv - AI Subtitles for Premiere Pro 🎬

An Adobe Premiere Pro extension that automatically generates highly accurate, perfectly synced subtitles directly on your timeline. Powered by **Faster-Whisper** (Python backend) and optimized with **Ivrit AI** models for unparalleled Hebrew accuracy.

![Ktv Premiere Pro Plugin](https://img.shields.io/badge/Adobe%20Premiere%20Pro-Supported-blue)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey)
![GPU](https://img.shields.io/badge/GPU-NVIDIA%20CUDA%20Supported-green)

## ✨ Features

- **100% Local & Private:** No cloud processing, no subscriptions, no data sent to third-party APIs. Your media stays on your machine.
- **Zero Cost:** Generate unlimited hours of transcription completely for free.
- **Unbeatable Hebrew Accuracy:** Built-in integration with [Ivrit.ai](https://ivrit.ai)'s state-of-the-art V2 and V3 Turbo models.
- **Blazing Fast:** Fully utilizes your NVIDIA GPU via CUDA. What takes hours manually now takes seconds.
- **Custom Dictionary:** Teach the AI specific names, brands, or slang to guarantee perfect spelling every time!
- **Auto Emojis:** Let the AI magically add relevant emojis to your subtitles based on the context of the sentence.
- **Native Integration:** Injects subtitles straight into Premiere Pro's native Caption tracks, ready for immediate styling and export.
- **Smart Engine:** Automatically exports the audio, runs the AI engine, generates SRT, and imports it back seamlessly.
- **Cancel Support:** Stop long transcriptions midway with a click of a button if you made a mistake.
- **Minimalist Architecture:** Designed with "Ponytail" principles—clean, lightweight, and highly maintainable with robust error handling and zero silent failures.

## 🚀 Installation (Windows Only)

1. Download or clone this repository to your computer.
2. Extract the ZIP file (if downloaded).
3. Double-click the **`Install_Ktv.bat`** script. 
   - *This script automatically copies the extension to Adobe's CEP folder and enables Developer Mode (PlayerDebugMode) so the plugin can run.*
4. Open **Adobe Premiere Pro**.
5. Go to the top menu: `Window` -> `Extensions` -> `Ktv - AI Subtitles`.

## 🛠️ Usage

1. Open your project in Premiere Pro.
2. Select your desired transcription range:
   - **Entire Sequence:** Transcribes the whole timeline.
   - **In to Out:** Transcribes only the specific segment marked by your In/Out points.
3. Choose your AI Model from the dropdown:
   - **Ivrit AI V3 Turbo:** The recommended, lightning-fast model for Hebrew.
   - **Ivrit AI V2:** The heavy, ultra-accurate model for Hebrew.
   - **Whisper Large V3 Turbo:** Best for English and general languages.
   - **English Translation:** Automatically translates Hebrew speech into English subtitles.
4. Set your preference for "Words per line" (e.g., 2 words per line is great for Shorts/TikToks).
5. Customize: Add specific words to the dictionary, or enable Auto Emojis.
6. Click **"✨ צור כתוביות" (Generate)**!

> **Note:** The very first time you click Generate, the plugin will automatically install the local Python environment, CUDA libraries, and download the AI models in the background (~2-4GB). This only happens once.

## ⚙️ System Requirements

- **OS:** Windows 10 / Windows 11
- **Software:** Adobe Premiere Pro (CC 2020 and newer)
- **GPU:** NVIDIA Graphics Card heavily recommended (The included engine uses CUDA for massive speed boosts). It will fallback to CPU if no NVIDIA GPU is detected, but will run significantly slower.

## 🙏 Acknowledgements

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) - The blazing-fast Python engine that powers this extension.
- [stable-ts](https://github.com/jianfch/stable-ts) - For reliable word-level timestamps and subtitle generation.
- [Ivrit.ai](https://huggingface.co/ivrit-ai) - For developing and open-sourcing the incredible Hebrew-optimized language models.

---

## 🤖 AI-Assisted Development
This project is part of an AI development portfolio, showcasing the power of human-AI collaboration in software engineering. The entire codebase, architecture, bug fixing, and optimization were pair-programmed alongside an advanced Agentic AI coding assistant.

---
*Built to save editors hundreds of hours of tedious transcription work.*
