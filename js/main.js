const csInterface = new CSInterface();
let currentSelectedModel = "";
let lastGeneratedSrtPath = "";

document.addEventListener('DOMContentLoaded', () => {
    const btnGenerate = document.getElementById('btn-generate');
    const modelSelect = document.getElementById('model-select');
    const hardwareSelect = document.getElementById('hardware-select');
    const statusContainer = document.getElementById('status-container');
    const statusText = document.getElementById('status-text');
    const progressFill = document.getElementById('progress-fill');
    const actionButtons = document.getElementById('action-buttons');
    const btnOpenSrt = document.getElementById('btn-open-srt');
    const btnShowSrt = document.getElementById('btn-show-srt');
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsContent = document.getElementById('settings-content');
    const wordsSelect = document.getElementById('words-select');
    const langSelect = document.getElementById('lang-select');
    const translateEn = document.getElementById('translate-en');
    const stripPunct = document.getElementById('strip-punct');

    // Load saved settings
    try {
        if (localStorage.getItem('subli_words')) wordsSelect.value = localStorage.getItem('subli_words');
        if (localStorage.getItem('subli_lang')) langSelect.value = localStorage.getItem('subli_lang');
        if (localStorage.getItem('subli_model')) modelSelect.value = localStorage.getItem('subli_model');
        if (localStorage.getItem('subli_hardware')) hardwareSelect.value = localStorage.getItem('subli_hardware');
        if (localStorage.getItem('subli_strip') !== null) stripPunct.checked = localStorage.getItem('subli_strip') === 'true';
        if (localStorage.getItem('subli_translate') !== null) translateEn.checked = localStorage.getItem('subli_translate') === 'true';
    } catch (e) {}

    // Save settings on change
    const saveSettings = () => {
        try {
            localStorage.setItem('subli_words', wordsSelect.value);
            localStorage.setItem('subli_lang', langSelect.value);
            localStorage.setItem('subli_model', modelSelect.value);
            localStorage.setItem('subli_hardware', hardwareSelect.value);
            localStorage.setItem('subli_strip', stripPunct.checked);
            localStorage.setItem('subli_translate', translateEn.checked);
        } catch (e) {}
    };

    [wordsSelect, langSelect, modelSelect, hardwareSelect, stripPunct, translateEn].forEach(el => {
        if(el) el.addEventListener('change', saveSettings);
    });

    // Auto-switch model for English
    langSelect.addEventListener('change', () => {
        if (langSelect.value === 'en') {
            modelSelect.value = 'ggml-large-v3-turbo.bin';
            saveSettings();
        }
    });
    
    // Range tabs logic
    let currentRange = 'entire';
    const tabBtns = document.querySelectorAll('#range-tabs .tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRange = e.target.getAttribute('data-value');
        });
    });

    // Accordion logic
    settingsToggle.addEventListener('click', () => {
        settingsToggle.classList.toggle('open');
        settingsContent.classList.toggle('open');
    });

    // Auto-detect GPU
    if (window.detectGPU) {
        window.detectGPU().then(gpuMode => {
            if (hardwareSelect) {
                hardwareSelect.value = gpuMode;
            }
        }).catch(err => console.error("GPU detection failed:", err));
    }

    btnGenerate.addEventListener('click', async () => {
        btnGenerate.disabled = true;
        currentSelectedModel = modelSelect.value;
        const currentHardware = hardwareSelect ? hardwareSelect.value : 'cpu';
        const maxWords = parseInt(wordsSelect.value);
        const isStripPunct = stripPunct.checked;
        const isTranslate = translateEn.checked;
        const lang = langSelect.value;
        
        statusContainer.classList.remove('hidden');
        actionButtons.classList.add('hidden');
        progressFill.style.width = `0%`;
        
        showStatus('מייצא אודיו מפרמייר (ברקע שקט)...', 10);

        try {
            const exportStatus = await startAudioExport(currentRange);
            
            if (exportStatus === 'ERROR: PRESET_MISSING') {
                throw new Error("לא נמצא קובץ הגדרות WAV במערכת.");
            } else if (exportStatus.startsWith('ERROR') || exportStatus === "false") {
                throw new Error("לא נמצא ציר זמן או שגיאה בייצוא: " + exportStatus);
            }
            
            const parts = exportStatus.split("|");
            const audioPath = parts[0];
            const startSeconds = parts.length > 1 ? parseFloat(parts[1]) : 0;
            
            showStatus('מוודא שמנוע ה-AI והמודל קיימים...', 30);
            
            // Pass progress callback to node process
            const srtPath = await window.nodeProcessAudio(audioPath, currentSelectedModel, currentHardware, maxWords, isStripPunct, lang, isTranslate, (status, percent) => {
                showStatus(status, percent);
            });
            
            lastGeneratedSrtPath = srtPath;

            showStatus('מייבא כתוביות לפרמייר...', 90);

            // Import SRT back to Premiere
            await importSrtToPremiere(srtPath, startSeconds);

            showStatus('מוכן! 🎉', 100);
            
            // Show action buttons
            setTimeout(() => {
                actionButtons.classList.remove('hidden');
                btnGenerate.disabled = false;
            }, 1000);
            
        } catch (error) {
            console.error("Transcription Error:", error);
            showError(`שגיאה: ${error.message}`);
        }
    });
    
    // Open SRT in text editor
    btnOpenSrt.addEventListener('click', () => {
        if (lastGeneratedSrtPath) {
            const cp = require('child_process');
            // Use Windows start command to open with default editor
            cp.exec(`start "" "${lastGeneratedSrtPath}"`);
        }
    });

    // Show SRT in Explorer
    btnShowSrt.addEventListener('click', () => {
        if (lastGeneratedSrtPath) {
            const cp = require('child_process');
            cp.exec(`explorer /select,"${lastGeneratedSrtPath}"`);
        }
    });

    function showStatus(text, percent) {
        statusText.innerText = text;
        progressFill.style.width = `${percent}%`;
    }

    function showError(text) {
        statusText.innerText = text;
        progressFill.style.width = `0%`;
        btnGenerate.disabled = false;
    }

    function startAudioExport(range) {
        return new Promise((resolve, reject) => {
            const script = `exportActiveTimelineAudio("${range}")`;
            csInterface.evalScript(script, (result) => {
                resolve(result);
            });
        });
    }

    function importSrtToPremiere(srtPath, startSeconds) {
        return new Promise((resolve, reject) => {
            const escapedPath = srtPath.replace(/\\/g, '\\\\');
            const script = `importSrtToTimeline("${escapedPath}", ${startSeconds})`;
            csInterface.evalScript(script, (result) => {
                resolve(result);
            });
        });
    }
});
