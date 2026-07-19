@echo off
echo Setting up Ktv Premiere V2 Backend...
cd /d "%~dp0"

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install faster-whisper stable-ts imageio-ffmpeg
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 torch torchaudio
echo Setup complete.
pause
