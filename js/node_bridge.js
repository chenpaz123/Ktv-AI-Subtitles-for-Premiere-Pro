const fs = require('fs');
const path = require('path');
const https = require('https');
const child_process = require('child_process');

function getExtDir() {
    return __dirname;
}

async function downloadFile(url, destPath, statusCallback, progressLabel) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                // Follow redirect
                return downloadFile(response.headers.location, destPath, statusCallback, progressLabel).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(destPath);
            const totalBytes = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes && statusCallback) {
                    const percent = Math.floor((downloadedBytes / totalBytes) * 100);
                    // Map 0-100 to the progress range we want for this stage
                    statusCallback(`${progressLabel} ${percent}%`, 35 + (percent * 0.15));
                }
            });

            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    if (totalBytes && downloadedBytes < totalBytes) {
                        try { fs.unlinkSync(destPath); } catch(e) {}
                        reject(new Error(`ההורדה נקטעה באמצע (${Math.floor(downloadedBytes/1024/1024)}MB מתוך ${Math.floor(totalBytes/1024/1024)}MB). אנא נסה שוב.`));
                    } else {
                        resolve(destPath);
                    }
                });
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

async function ensureWhisperCpp(hardwareMode, statusCallback) {
    const extDir = getExtDir();
    // Use v1.9.1 suffix to force re-download of the new version which supports Turbo architecture
    const binDir = path.join(extDir, `ext_bin_v1.9.1_${hardwareMode}`);
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir);

    const isWin = process.platform === 'win32';
    const exeName = isWin ? 'whisper-cli.exe' : 'whisper-cli';
    let exePath = path.join(binDir, exeName);


    function findExe(dir, targetName) {
        if (!fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const found = findExe(fullPath, targetName);
                if (found) return found;
            } else if (file === targetName) {
                return fullPath;
            }
        }
        return null;
    }

    const existingExe = findExe(binDir, exeName);
    if (existingExe) {
        return existingExe;
    }

    statusCallback('מוריד מנוע AI (whisper.cpp)...', 35);
    if (isWin) {
        let zipUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip";
        if (hardwareMode === 'nvidia') {
            zipUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.9.1/whisper-cublas-11.8.0-bin-x64.zip";
        } else if (hardwareMode === 'amd') {
            zipUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.9.1/whisper-blas-bin-x64.zip";
        }
        
        const zipPath = path.join(binDir, 'whisper.zip');
        
        await downloadFile(zipUrl, zipPath, statusCallback, "מוריד קבצי מנוע:");
        statusCallback('מחלץ קבצים...', 50);
        
        // Extract ZIP using tar (built into Windows 10+)
        return new Promise((resolve, reject) => {
            child_process.exec(`tar -xf "${zipPath}" -C "${binDir}"`, (error) => {
                if (error) {
                    reject(new Error("Failed to extract whisper.cpp: " + error.message));
                } else {
                    try { fs.unlinkSync(zipPath); } catch (e) {}
                    // Find the executable first to know where to put the DLLs
                    const foundExe = findExe(binDir, exeName);
                    if (foundExe) {
                        const exeDir = path.dirname(foundExe);
                        // Backport missing CUDA DLLs from v1.5.4 if using NVIDIA
                        if (hardwareMode === 'nvidia' && !fs.existsSync(path.join(exeDir, 'cublas64_11.dll'))) {
                            statusCallback('משלים קבצי תאימות לכרטיס מסך...', 55);
                            const dllZipPath = path.join(binDir, 'dlls.zip');
                            downloadFile("https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.4/whisper-cublas-11.8.0-bin-x64.zip", dllZipPath, statusCallback, 'משלים קבצים')
                            .then(() => {
                                child_process.exec(`powershell -command "Expand-Archive -Path '${dllZipPath}' -DestinationPath '${path.join(binDir, 'temp_dlls')}' -Force; Copy-Item -Path '${path.join(binDir, 'temp_dlls')}/cublas*.dll', '${path.join(binDir, 'temp_dlls')}/cudart*.dll' -Destination '${exeDir}/' -Force"`, (err) => {
                                    try { fs.unlinkSync(dllZipPath); } catch(e) {}
                                    try { fs.rmSync(path.join(binDir, 'temp_dlls'), { recursive: true, force: true }); } catch(e) {}
                                    resolve(foundExe);
                                });
                            }).catch(() => resolve(foundExe)); // resolve anyway if it fails
                        } else {
                            resolve(foundExe);
                        }
                    } else {
                        reject(new Error("Executable not found in ZIP."));
                    }
                }
            });
        });
    }
    return exePath;
}

async function ensureModel(modelName, statusCallback) {
    const extDir = getExtDir();
    const modelsDir = path.join(extDir, 'ext_models');
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir);

    const modelPath = path.join(modelsDir, modelName);
    
    if (!fs.existsSync(modelPath)) {
        let modelUrl = "";
        if (modelName === 'ivrit-ai-2-ggml.bin') {
            modelUrl = "https://huggingface.co/ivrit-ai/whisper-v2-d4-ggml/resolve/main/ggml-ivrit-v2-d4.bin";
        } else if (modelName === 'ivrit-ai-v3-turbo.bin') {
            modelUrl = "https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ggml/resolve/main/ggml-model.bin";
        } else if (modelName === 'ggml-large-v3-turbo.bin') {
            modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";
        } else {
            modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin";
        }

        statusCallback(`מוריד מודל עברית (${modelName})... זה ייקח קצת זמן`, 55);
        await downloadFile(modelUrl, modelPath, statusCallback, "הורדת מודל:");
    }
    
    return modelPath;
}

window.nodeProcessAudio = async function(audioPath, modelName, hardwareMode, maxWords, stripPunctuation, lang, isTranslate, statusCallback) {
    return new Promise(async (resolve, reject) => {
        try {

            // Whisper V3 (Turbo) has a known bug in whisper.cpp where it ignores the -tr flag.
            // If translation is requested, force the highly stable Medium model which translates perfectly.
            if (isTranslate) {
                modelName = 'ggml-medium.bin';
            }

            const exePath = await ensureWhisperCpp(hardwareMode, statusCallback);
            const modelPath = await ensureModel(modelName, statusCallback);
            
            statusCallback('מתחיל תמלול מקומי בטכנולוגיית AI... אנא המתן', 75);
            
            const srtOutputPath = audioPath + ".srt";

            // Execute local AI
            let cmd = `"${exePath}" -m "${modelPath}" -f "${audioPath}" -osrt -l ${lang || 'he'}`;
            if (isTranslate) {
                cmd += ' -tr'; // Add translate flag
            }
            
            // whisper.cpp does not support -mw. We approximate words to chars (avg 6 chars per word)
            // -sow ensures words are never chopped in half.
            // -mc 0 (max context 0) is equivalent to condition_on_previous_text=False in python, preventing hallucinations and endless segments.
            let maxLen = 42; // default unlimited (standard TV size)
            if (maxWords && maxWords !== "0" && maxWords !== 0) {
                maxLen = parseInt(maxWords) * 6;
            }
            cmd += ` -ml ${maxLen} -sow -mc 0`;
            
            child_process.exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error("Transcription failed: " + error.message));
                    return;
                }
                
                if (!fs.existsSync(srtOutputPath)) {
                    reject(new Error("שגיאה במנוע ה-AI: קובץ הכתוביות לא נוצר."));
                    return;
                }
                
                try {
                    if (fs.existsSync(srtOutputPath)) {
                        let srtContent = fs.readFileSync(srtOutputPath, 'utf8');
                        
                        // Handle completely empty transcription
                        if (srtContent.trim() === '') {
                            srtContent = '1\n00:00:00,000 --> 00:00:02,000\n[לא זוהה דיבור]';
                        }
                        
                        // Premiere Pro requires CRLF line endings for SRT
                        srtContent = srtContent.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
                        
                        // Fix RTL punctuation, formatting, and dynamically CAP maximum duration to create gaps during silences
                        const rtlRegex = /[\u0590-\u05FF]/; // basic Hebrew unicode range
                        const punctRegex = /[.,!?;:"'`´‘’“”„‚«»‹›…()\[\]{}‐-―־׳״-]/g;
                        const lines = srtContent.split('\r\n');
                        
                        function parseTime(timeStr) {
                            const p = timeStr.split(':');
                            const s = p[2].split(',');
                            return parseInt(p[0])*3600 + parseInt(p[1])*60 + parseInt(s[0]) + parseInt(s[1])/1000;
                        }
                        function formatTime(seconds) {
                            const h = Math.floor(seconds / 3600);
                            const m = Math.floor((seconds % 3600) / 60);
                            const s = Math.floor(seconds % 60);
                            const ms = Math.floor((seconds % 1) * 1000);
                            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
                        }

                        for (let i = 0; i < lines.length; i++) {
                            // Detect timestamp line
                            if (lines[i] && lines[i].includes('-->')) {
                                let parts = lines[i].split(' --> ');
                                if (parts.length === 2) {
                                    let start = parseTime(parts[0]);
                                    let end = parseTime(parts[1]);
                                    
                                    // Gather text for this segment to calculate reading time
                                    let textLen = 0;
                                    let j = i + 1;
                                    while (j < lines.length && lines[j].trim() !== '' && !lines[j].includes('-->')) {
                                        if (!lines[j].match(/^\d+$/)) { // Skip sequence number
                                            textLen += lines[j].trim().length;
                                        }
                                        j++;
                                    }
                                    
                                    // To make it feel more like TV series, we give a generous reading time.
                                    // ~12 chars per second + 2.5 seconds buffer so it stays on screen during short silences.
                                    let maxAllowedDuration = (textLen / 12) + 2.5;
                                    // Hard cap at 7 seconds maximum (Netflix standard max)
                                    maxAllowedDuration = Math.min(maxAllowedDuration, 7.0);
                                    // Minimum 2 seconds so it doesn't flicker away too fast
                                    maxAllowedDuration = Math.max(maxAllowedDuration, 2.0);
                                    
                                    if (end - start > maxAllowedDuration) {
                                        end = start + maxAllowedDuration;
                                        lines[i] = formatTime(start) + ' --> ' + formatTime(end);
                                    }
                                }
                            }
                            // Only apply to text lines (not sequence number, timestamp, or empty lines)
                            else if (lines[i] && !lines[i].match(/^\d+$/) && !lines[i].includes('-->')) {
                                if (stripPunctuation) {
                                    lines[i] = lines[i].replace(punctRegex, ' ').replace(/[ \t]{2,}/g, ' ').trim();
                                }
                                if (rtlRegex.test(lines[i])) {
                                    lines[i] = '\u202B' + lines[i] + '\u202C';
                                }
                            }
                        }
                        srtContent = lines.join('\r\n');
                        
                        // Premiere Pro requires UTF-8 BOM for Hebrew SRTs
                        if (srtContent.charCodeAt(0) !== 0xFEFF) {
                            srtContent = '\uFEFF' + srtContent;
                        }
                        
                        fs.writeFileSync(srtOutputPath, srtContent, 'utf8');
                    }
                } catch (fixErr) {
                    console.error("Failed to fix SRT encoding for Premiere:", fixErr);
                }
                
                // Delete the temporary WAV file to avoid cluttering the user's project folder
                try {
                    if (fs.existsSync(audioPath)) {
                        fs.unlinkSync(audioPath);
                    }
                } catch (delErr) {
                    console.error("Failed to delete temp wav:", delErr);
                }

                statusCallback('מעבד קובץ כתוביות סופי...', 90);
                resolve(srtOutputPath);
            });

        } catch (e) {
            reject(e);
        }
    });
};

window.detectGPU = async function() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve('cpu');
            return;
        }
        
        child_process.exec('wmic path win32_VideoController get name', (error, stdout) => {
            if (error) {
                resolve('cpu');
                return;
            }
            
            const output = stdout.toLowerCase();
            if (output.includes('nvidia')) {
                resolve('nvidia');
            } else if (output.includes('amd') || output.includes('radeon')) {
                resolve('amd');
            } else {
                resolve('cpu');
            }
        });
    });
};
