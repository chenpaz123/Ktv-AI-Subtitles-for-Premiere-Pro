/**
 * Ktv Premiere Extension - Node.js Bridge
 * Handles whisper.cpp execution, model management, GPU detection
 *
 * Restored auto-download behavior from original: downloads correct binary for hardware
 * Added: timeout handling, cancellation, error recovery, progress mapping
 */

var fs = require('fs');
var path = require('path');
const child_process = require('child_process');
const { promisify } = require('util');
const https = require('https');
const http = require('http');

const execPromise = promisify(child_process.exec);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Configuration ─────────────────────────────────────────────────────



var csInterface = new CSInterface();
const CONFIG = {
    // Basic settings
    DEBUG: true,

    // Timeouts
    WHISPER_TIMEOUT_MS: 30 * 60 * 1000,      // 30 minutes max for transcription
    DOWNLOAD_TIMEOUT_MS: 10 * 60 * 1000,     // 10 minutes for model download
    GPU_DETECT_TIMEOUT_MS: 5000,             // 5 seconds for GPU detection

    // Paths
    EXTENSION_ROOT: csInterface.getSystemPath(SystemPath.EXTENSION),

    // Whisper.cpp releases
    WHISPER_VERSION: 'v1.9.1',
    WHISPER_DLL_VERSION: 'v1.5.4',  // For CUDA DLLs backport

    // Model URLs
    MODEL_URLS: {
        'ivrit-ai-2-ggml.bin': 'https://huggingface.co/ivrit-ai/whisper-v2-d4-ggml/resolve/main/ggml-ivrit-v2-d4.bin',
        'ivrit-ai-v3-turbo.bin': 'https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ggml/resolve/main/ggml-model.bin',
        'ggml-large-v3-turbo.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
        'ggml-medium.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin'
    },

    // SRT formatting
    MAX_CHARS_PER_SEC: 12,
    MIN_SEGMENT_DURATION: 2.0,
    MAX_SEGMENT_DURATION: 7.0,
    RTL_MARK_START: '‫',
    RTL_MARK_END: '‬',
    BOM: '﻿'
};

// ─── State ──────────────────────────────────────────────────────────────

let activeProcess = null;
let isCancelled = false;

// ─── Utility Functions ──────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getExtensionRoot() {
    return CONFIG.EXTENSION_ROOT;
}

function getModelsDir() {
    const dir = path.join(CONFIG.EXTENSION_ROOT, 'ext_models');
    ensureDir(dir);
    return dir;
}

// ─── Download with Progress ─────────────────────────────────────────────

async function downloadFile(url, destPath, progressCallback, label) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const req = client.get(url, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    downloadFile(redirectUrl, destPath, progressCallback, label).then(resolve).catch(reject);
                    return;
                }
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            const total = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(destPath);

            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0 && progressCallback) {
                    // Map download progress to 55-75% range
                    const percent = 55 + Math.floor((downloaded / total) * 20);
                    const mbDown = Math.floor(downloaded / 1024 / 1024);
                    const mbTotal = Math.floor(total / 1024 / 1024);
                    progressCallback(`${label} ${mbDown}MB / ${mbTotal}MB`, percent);
                }
            });

            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
            file.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });

        req.setTimeout(CONFIG.DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error('Download timeout'));
        });

        req.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

// ─── GPU Detection ──────────────────────────────────────────────────────

function detectGPU() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve('cpu');
            return;
        }

        const timeout = setTimeout(() => resolve('cpu'), CONFIG.GPU_DETECT_TIMEOUT_MS);

        child_process.exec('wmic path win32_VideoController get name', (error, stdout) => {
            clearTimeout(timeout);
            if (error) {
                resolve('cpu');
                return;
            }

            const output = stdout.toLowerCase();
            if (output.includes('nvidia')) resolve('nvidia');
            else if (output.includes('amd') || output.includes('radeon')) resolve('amd');
            else resolve('cpu');
        });
    });
}

// ─── Python Backend Management ──────────────────────────────────────────

async function ensurePythonEnv(progressCallback) {
    const extDir = CONFIG.EXTENSION_ROOT;
    const backendDir = path.join(extDir, 'backend');
    const venvPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
    const setupBat = path.join(backendDir, 'setup.bat');

    if (fs.existsSync(venvPython)) {
        if (progressCallback) {
            progressCallback('מנוע הפייתון מוכן', 70);
        }
        return venvPython;
    }

    if (progressCallback) {
        progressCallback('מתקין סביבת פייתון למנוע החדש (יקרה פעם אחת בלבד)...', 30);
    }

    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env);
        if (!env.ComSpec && !env.comspec) env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
        if (!env.SystemRoot) env.SystemRoot = "C:\\Windows";
        if (!env.PATH) env.PATH = "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem";

        child_process.exec(`"${setupBat}"`, { cwd: backendDir, env: env, shell: env.ComSpec || env.comspec, maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error("Failed to setup Python environment: " + error.message));
                return;
            }
            if (fs.existsSync(venvPython)) {
                resolve(venvPython);
            } else {
                reject(new Error("Python environment creation failed."));
            }
        });
    });
}

// ─── SRT Formatting ─────────────────────────────────────────────────────

function parseSRTTime(timeStr) {
    const parts = timeStr.split(':');
    const secondsParts = parts[2].split(',');
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(secondsParts[0]) + parseInt(secondsParts[1]) / 1000;
}

function formatSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatSrtContent(srtContent, stripPunctuation) {
    if (!srtContent || srtContent.trim() === '') {
        return `${CONFIG.BOM}1\r\n00:00:00,000 --> 00:00:02,000\r\n[לא זוהה דיבור]\r\n`;
    }

    // Normalize line endings
    srtContent = srtContent.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    const lines = srtContent.split('\r\n');
    const rtlRegex = /[֐-׿]/;
    const punctRegex = /[.,!?;:"'`´‘’“”„‚«»‹›…()\[\]{}‐-―־׳״-]/g;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i] && lines[i].includes('-->')) {
            // Parse and potentially fix segment duration based on text length
            const parts = lines[i].split(' --> ');
            if (parts.length === 2) {
                const start = parseSRTTime(parts[0]);
                const end = parseSRTTime(parts[1]);

                // Calculate text length for this segment
                let textLen = 0;
                let j = i + 1;
                while (j < lines.length && lines[j].trim() !== '' && !lines[j].includes('-->')) {
                    if (!lines[j].match(/^\d+$/)) {
                        textLen += lines[j].trim().length;
                    }
                    j++;
                }

                const maxAllowed = Math.min(CONFIG.MAX_SEGMENT_DURATION, Math.max(CONFIG.MIN_SEGMENT_DURATION, (textLen / CONFIG.MAX_CHARS_PER_SEC) + 2.5));

                if (end - start > maxAllowed) {
                    const newEnd = start + maxAllowed;
                    lines[i] = formatSRTTime(start) + ' --> ' + formatSRTTime(newEnd);
                }
            }
        } else if (lines[i] && !lines[i].match(/^\d+$/) && !lines[i].includes('-->')) {
            // Text line - strip punctuation if requested, add RTL marks for Hebrew
            if (stripPunctuation) {
                lines[i] = lines[i].replace(punctRegex, ' ').replace(/[ \t]{2,}/g, ' ').trim();
            }
            if (rtlRegex.test(lines[i])) {
                lines[i] = CONFIG.RTL_MARK_START + lines[i] + CONFIG.RTL_MARK_END;
            }
        }
    }

    srtContent = lines.join('\r\n');

    // Ensure UTF-8 BOM for Premiere
    if (srtContent.charCodeAt(0) !== 0xFEFF) {
        srtContent = CONFIG.BOM + srtContent;
    }

    return srtContent;
}

// ─── Cancellation Support ───────────────────────────────────────────────

function cancelCurrentProcess() {
    isCancelled = true;
    if (activeProcess) {
        try {
            if (process.platform === 'win32' && activeProcess.pid) {
                child_process.exec(`taskkill /pid ${activeProcess.pid} /T /F`, () => {});
            } else {
                activeProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (activeProcess) {
                        activeProcess.kill('SIGKILL');
                    }
                }, 5000);
            }
        } catch (e) {
            console.warn('Failed to kill process:', e.message);
        }
    }
}

// ─── Main Audio Processing Function ─────────────────────────────────────

async function processAudio(audioPath, modelName, hardwareMode, maxWords, stripPunctuation, lang, isTranslate, progressCallback) {
    isCancelled = false;

    try {
        if (isTranslate) {
            modelName = 'medium';
        } else {
            const modelMap = {
                'ggml-large-v3-turbo.bin': 'deepdml/faster-whisper-large-v3-turbo-ct2',
                'ivrit-ai-v3-turbo.bin': 'deepdml/faster-whisper-large-v3-turbo-ct2',
                'ivrit-ai-2-ggml.bin': 'ivrit-ai/faster-whisper-v2-d4',
                'ggml-medium.bin': 'medium'
            };
            modelName = modelMap[modelName] || modelName;
        }

        if (progressCallback) {
            progressCallback('מוודא שמנוע ה-AI והמודל קיימים...', 50);
        }

        // Ensure Python environment is ready
        const pythonExe = await ensurePythonEnv(progressCallback);

        if (isCancelled) throw new Error('Cancelled by user');

        if (progressCallback) {
            progressCallback('מתחיל תמלול מקומי בטכנולוגיית AI... אנא המתן', 75);
        }

        const srtOutputPath = audioPath + ".srt";

        // Build python command
        const transcribeScript = path.join(CONFIG.EXTENSION_ROOT, 'backend', 'transcribe.py');
        let cmd = `"${pythonExe}" "${transcribeScript}" --audio "${audioPath}"`;
        
        if (modelName) {
             cmd += ` --model "${modelName}"`;
        }

        if (lang) {
            cmd += ` --lang "${lang}"`;
        }

        if (hardwareMode) {
            if (hardwareMode === 'nvidia') {
                cmd += ` --device cuda`;
            } else if (hardwareMode === 'cpu' || hardwareMode === 'amd') {
                cmd += ` --device cpu`;
            } else {
                cmd += ` --device auto`;
            }
        }

        if (isTranslate) {
            cmd += ' --translate';
        }

        if (maxWords && maxWords !== "0" && maxWords !== 0) {
            cmd += ` --max-words ${maxWords}`;
        }

        // Add Dictionary and Emoji support
        const os = require('os');
        const dictPath = path.join(os.homedir(), "AppData", "Local", "Ktv", "dictionary.json");
        if (fs.existsSync(dictPath)) {
            cmd += ` --dict "${dictPath}"`;
        }
        
        const emojiCfgPath = path.join(os.homedir(), "AppData", "Local", "Ktv", "emoji.json");
        try {
            const emojiCfg = JSON.parse(fs.readFileSync(emojiCfgPath, 'utf8'));
            if (emojiCfg && emojiCfg.enabled) {
                cmd += ` --emoji`;
            }
        } catch (e) {}

        // Execute with timeout and cancellation support
        await executeWithTimeout(cmd, CONFIG.WHISPER_TIMEOUT_MS, () => isCancelled);

        if (isCancelled) throw new Error('Cancelled by user');

        if (!fs.existsSync(srtOutputPath)) {
            throw new Error("שגיאה במנוע ה-AI: קובץ הכתוביות לא נוצר.");
        }

        // Fix SRT formatting for Premiere
        try {
            let srtContent = fs.readFileSync(srtOutputPath, 'utf8');
            srtContent = formatSrtContent(srtContent, stripPunctuation);
            fs.writeFileSync(srtOutputPath, srtContent, 'utf8');
        } catch (fixErr) {
            console.error("Failed to fix SRT encoding for Premiere:", fixErr);
        }

        // Clean up temp audio file
        try {
            if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
            }
        } catch (delErr) {
            console.warn("Failed to delete temp wav (might be locked by OS):", delErr.message);
        }

        if (progressCallback) {
            progressCallback('מעבד קובץ כתוביות סופי...', 90);
        }

        return srtOutputPath;

    } catch (e) {
        // Handle model corruption
        if (e.message.includes("failed to load model")) {
            throw new Error("קובץ המודל לא נטען בהצלחה. ייתכן שיש בעיה בחיבור לאינטרנט או שחסר מקום בכונן של המחשב. נסה שוב.");
        }
        throw e;
    }
}

async function executeWithTimeout(command, timeoutMs, cancelledCheck) {
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env);
        if (!env.ComSpec && !env.comspec) env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
        if (!env.SystemRoot) env.SystemRoot = "C:\\Windows";
        if (!env.PATH) env.PATH = "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem";

        activeProcess = child_process.exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10, env: env, shell: env.ComSpec || env.comspec }, (error, stdout, stderr) => {
            activeProcess = null;
            if (error) {
                if (cancelledCheck()) {
                    reject(new Error('Cancelled by user'));
                } else {
                    reject(error);
                }
            } else {
                resolve(stdout);
            }
        });

        // Poll for cancellation
        const pollInterval = setInterval(() => {
            if (cancelledCheck()) {
                clearInterval(pollInterval);
                cancelCurrentProcess();
            }
        }, 100);

        // Cleanup on process exit
        const cleanup = () => {
            clearInterval(pollInterval);
            activeProcess = null;
        };
    });
}

// ─── Public API ─────────────────────────────────────────────────────────

window.nodeProcessAudio = async function(audioPath, modelName, hardwareMode, maxWords, stripPunctuation, lang, isTranslate, progressCallback) {
    try {
        return await processAudio(audioPath, modelName, hardwareMode, maxWords, stripPunctuation, lang, isTranslate, progressCallback);
    } catch (e) {
        console.error("Audio processing error:", e);
        throw e;
    } finally {
        try {
            if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
                console.log("Deleted temporary audio file:", audioPath);
            }
        } catch (cleanupErr) {
            console.error("Failed to delete temporary audio file:", cleanupErr);
        }
    }
};

window.detectGPU = detectGPU;

window.cancelTranscription = function() {
    cancelCurrentProcess();
};

// Expose for debugging
window.__ktv_debug = {
    CONFIG,
    cancelCurrentProcess,
    detectGPU
};
