@echo off
chcp 65001 >nul
color 0B
echo ==========================================
echo       Ktv - AI Subtitles Installer
echo ==========================================
echo.
echo Installing Ktv extension for Premiere Pro...

set "EXT_DIR=%APPDATA%\Adobe\CEP\extensions\subli"

echo.
echo [1/3] Creating extension directory...
if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"

echo [2/3] Copying extension files...
xcopy "%~dp0*" "%EXT_DIR%\" /E /I /H /Y >nul

echo [3/3] Enabling Adobe Extension Mode (PlayerDebugMode)...
for /L %%i in (10, 1, 18) do (
    reg add "HKCU\Software\Adobe\CSXS.%%i" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
)

echo.
echo ==========================================
echo SUCCESS! Ktv has been installed.
echo ==========================================
echo.
echo Please restart Premiere Pro (if it is open).
echo You can find the extension inside Premiere under:
echo Window -^> Extensions -^> Ktv - AI Subtitles
echo.
pause
