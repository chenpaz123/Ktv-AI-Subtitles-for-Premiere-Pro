/**
 * Ktv Premiere Extension - Main UI Logic
 * Refactored for: better state management, cancellation support, cleaner separation
 */

var csInterface = new CSInterface();

var fs = require('fs');
var path = require('path');
var os = require('os');
const appDataDir = path.join(os.homedir(), "AppData", "Local", "Ktv");
if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });

function ensureEmojiPng(emoji, nameOverride) {
    try {
        var dir = path.join(appDataDir, "emoji_png");
        var cps = [];
        for (var i = 0; i < emoji.length;) {
            var cp = emoji.codePointAt(i);
            if (cp !== 0xFE0F) cps.push(cp.toString(16));
            i += cp > 0xFFFF ? 2 : 1;
        }
        var file = path.join(dir, "emoji_" + (nameOverride || cps.join("-")) + ".png").replace(/\\/g, "/");
        if (fs.existsSync(file)) return file;
        var canvas = document.createElement("canvas");
        canvas.width = 256; canvas.height = 256;
        var ctx = canvas.getContext("2d");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = '200px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
        ctx.fillText(emoji, 128, 140);
        var b64 = canvas.toDataURL("image/png").split(",")[1];
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(b64, "base64"));
        return file;
    } catch (e) { return null; }
}

function emojiPath() { return path.join(appDataDir, "emoji.json"); }
function readEmojiCfg() {
    try { return JSON.parse(fs.readFileSync(emojiPath(), "utf8").replace(/^﻿/, "")) || {}; }
    catch (e) { return {}; }
}
function saveEmojiFromUI() {
    var on = document.getElementById("emojiOn").checked;
    var density = 50 - parseInt(document.getElementById("emojiLevel").value, 10);
    density = Math.max(1, Math.min(50, density || 25));
    try {
        var cfg = readEmojiCfg();
        cfg.enabled = on; cfg.density = density; cfg.mode = "png";
        fs.writeFileSync(emojiPath(), JSON.stringify(cfg), "utf8");
    } catch (e) { }
    renderEmojiCard();
}
function emojiDensityFromCfg(cfg) {
    var d = parseInt(cfg.density, 10);
    if (!d) return 25;
    return Math.max(1, Math.min(50, d));
}
function renderEmojiCard() {
    var cfg = readEmojiCfg();
    var on = !!cfg.enabled;
    var density = emojiDensityFromCfg(cfg);
    if (document.getElementById("emojiOn")) document.getElementById("emojiOn").checked = on;
    if (document.getElementById("emojiLevel")) {
        document.getElementById("emojiLevel").value = String(50 - density);
        document.getElementById("emojiLevel").disabled = !on;
    }
    if (document.getElementById("emojiSliderWrap")) document.getElementById("emojiSliderWrap").style.opacity = on ? "1" : ".45";
    if (document.getElementById("emojiState")) document.getElementById("emojiState").textContent = on ? "(פעיל)" : "";
    if (document.getElementById("emojiHint")) document.getElementById("emojiHint").textContent = on
        ? (density === 1 ? "מקסימום - אימוג'י על כל מילה מתאימה" : "בערך אימוג'י אחד לכל " + density + " מילים")
        : "כבוי - הכתוביות יישארו בלי אימוג'ים.";
}
function placeEmojiTarget() {
    try {
        var png = ensureEmojiPng("🎯", "target");
        if (!png) return;
        csInterface.evalScript(`lcPlaceEmojiTarget("${png.replace(/\\/g, '/')}")`);
    } catch (e) {}
}
function applyEmojiLocation() {
    try {
        csInterface.evalScript(`lcApplyEmojiTargetToAll("emoji_target.png")`, (rStr) => {
            let r = JSON.parse(rStr);
            if (r && r.ok) {
                try {
                    var cfg = readEmojiCfg();
                    cfg.pos = r.pos;
                    if (r.scale !== null && r.scale !== undefined) cfg.scale = r.scale;
                    fs.writeFileSync(emojiPath(), JSON.stringify(cfg), "utf8");
                } catch (eP) { }
            }
        });
    } catch (e) {}
}

function dictPath() { return path.join(appDataDir, "dictionary.json"); }
function readDictRaw() {
    try { return JSON.parse(fs.readFileSync(dictPath(), "utf8").replace(/^﻿/, "")); } catch (e) { return []; }
}
function writeDictRaw(lines) {
    try { fs.writeFileSync(dictPath(), JSON.stringify(lines, null, 2), "utf8"); } catch (e) { }
}
function removeDictTerm(term) {
    var raw = readDictRaw();
    var idx = raw.indexOf(term);
    if (idx !== -1) { raw.splice(idx, 1); writeDictRaw(raw); renderDict(); }
}
function renderDict() {
    var terms = readDictRaw();
    var list = document.getElementById("dictList"); if (!list) return;
    list.innerHTML = "";
    terms.forEach(function (term) {
        var chip = document.createElement("span"); chip.className = "dict-chip";
        var label = document.createElement("span"); label.textContent = term;
        var x = document.createElement("button"); x.type = "button"; x.textContent = "×";
        x.addEventListener("click", function () { removeDictTerm(term); });
        chip.appendChild(label); chip.appendChild(x); list.appendChild(chip);
    });
    if (document.getElementById("dictEmpty")) document.getElementById("dictEmpty").style.display = terms.length ? "none" : "";
    if (document.getElementById("dictCount")) document.getElementById("dictCount").textContent = terms.length ? "(" + terms.length + ")" : "";
}
function addDictTerm(text) {
    text = String(text || "").trim().replace(/\s+/g, " ");
    if (!text) return;
    var raw = readDictRaw();
    if (raw.some(l => l.toLowerCase() === text.toLowerCase())) { 
        document.getElementById("dictInput").value = ""; return; 
    }
    raw.push(text); writeDictRaw(raw);
    document.getElementById("dictInput").value = ""; renderDict();
}

const STATE = {
    currentModel: '',
    lastSrtPath: '',
    currentRange: 'entire',
    isProcessing: false,
    settings: {}
};

const ELEMENTS = {};

const STORAGE_KEYS = {
    words: 'ktv_words',
    lang: 'ktv_lang',
    model: 'ktv_model',
    hardware: 'ktv_hardware',
    stripPunct: 'ktv_strip',
    translate: 'ktv_translate'
};

const DEFAULT_SETTINGS = {
    words: '2',
    lang: 'he',
    model: 'ivrit-ai-v3-turbo.bin',
    hardware: 'cpu',
    stripPunct: false,
    translate: false
};

// ─── DOM Initialization ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initElements();
    loadSettings();
    bindEvents();
    initGPUDetection();
});

function initElements() {
    ELEMENTS.btnGenerate = document.getElementById('btn-generate');
    ELEMENTS.modelSelect = document.getElementById('model-select');
    ELEMENTS.hardwareSelect = document.getElementById('hardware-select');
    ELEMENTS.statusContainer = document.getElementById('status-container');
    ELEMENTS.statusText = document.getElementById('status-text');
    ELEMENTS.progressFill = document.getElementById('progress-fill');
    ELEMENTS.actionButtons = document.getElementById('action-buttons');
    ELEMENTS.btnOpenSrt = document.getElementById('btn-open-srt');
    ELEMENTS.btnShowSrt = document.getElementById('btn-show-srt');
    ELEMENTS.settingsToggle = document.getElementById('settings-toggle');
    ELEMENTS.settingsContent = document.getElementById('settings-content');
    ELEMENTS.wordsSelect = document.getElementById('words-select');
    ELEMENTS.langSelect = document.getElementById('lang-select');
    ELEMENTS.translateEn = document.getElementById('translate-en');
    ELEMENTS.stripPunct = document.getElementById('strip-punct');
    ELEMENTS.rangeTabs = document.querySelectorAll('#range-tabs .tab-btn');
}

function bindEvents() {
    // Generate button
    ELEMENTS.btnGenerate.addEventListener('click', onGenerateClick);

    // Action buttons
    ELEMENTS.btnOpenSrt.addEventListener('click', onOpenSrt);
    ELEMENTS.btnShowSrt.addEventListener('click', onShowSrt);

    // Settings accordion
    ELEMENTS.settingsToggle.addEventListener('click', toggleSettings);

    // Settings persistence
    const settingElements = [
        ELEMENTS.wordsSelect, ELEMENTS.langSelect, ELEMENTS.modelSelect,
        ELEMENTS.hardwareSelect, ELEMENTS.stripPunct, ELEMENTS.translateEn
    ];
    settingElements.forEach(el => {
        if (el) el.addEventListener('change', saveSettings);
    });

    // Auto-switch model for English
    ELEMENTS.langSelect.addEventListener('change', () => {
        if (ELEMENTS.langSelect.value === 'en') {
            ELEMENTS.modelSelect.value = 'ggml-large-v3-turbo.bin';
            saveSettings();
        }
    });

    // Range tabs
    ELEMENTS.rangeTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            ELEMENTS.rangeTabs.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            STATE.currentRange = e.target.dataset.value;
        });
    });

    // Window unload - save settings
    window.addEventListener('beforeunload', saveSettings);

    renderDict();
    renderEmojiCard();
    document.getElementById("dictAdd").addEventListener("click", function () { addDictTerm(document.getElementById("dictInput").value); });
    document.getElementById("dictInput").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); addDictTerm(document.getElementById("dictInput").value); }
    });
    document.getElementById("emojiOn").addEventListener("change", saveEmojiFromUI);
    document.getElementById("emojiLevel").addEventListener("input", saveEmojiFromUI);
    document.getElementById("emojiTargetBtn").addEventListener("click", placeEmojiTarget);
    document.getElementById("emojiApplyBtn").addEventListener("click", applyEmojiLocation);
}

// ─── Settings Management ──────────────────────────────────────────────

function loadSettings() {
    try {
        STATE.settings = {
            words: localStorage.getItem(STORAGE_KEYS.words) || DEFAULT_SETTINGS.words,
            lang: localStorage.getItem(STORAGE_KEYS.lang) || DEFAULT_SETTINGS.lang,
            model: localStorage.getItem(STORAGE_KEYS.model) || DEFAULT_SETTINGS.model,
            hardware: localStorage.getItem(STORAGE_KEYS.hardware) || DEFAULT_SETTINGS.hardware,
            stripPunct: localStorage.getItem(STORAGE_KEYS.stripPunct) === 'true',
            translate: localStorage.getItem(STORAGE_KEYS.translate) === 'true'
        };

        ELEMENTS.wordsSelect.value = STATE.settings.words;
        ELEMENTS.langSelect.value = STATE.settings.lang;
        ELEMENTS.modelSelect.value = STATE.settings.model;
        ELEMENTS.hardwareSelect.value = STATE.settings.hardware;
        ELEMENTS.stripPunct.checked = STATE.settings.stripPunct;
        ELEMENTS.translateEn.checked = STATE.settings.translate;

    } catch (e) {
        console.error("Failed to load settings:", e);
        resetToDefaults();
    }
}

function saveSettings() {
    try {
        const settings = {
            words: ELEMENTS.wordsSelect.value,
            lang: ELEMENTS.langSelect.value,
            model: ELEMENTS.modelSelect.value,
            hardware: ELEMENTS.hardwareSelect.value,
            stripPunct: ELEMENTS.stripPunct.checked,
            translate: ELEMENTS.translateEn.checked
        };

        Object.entries(settings).forEach(([key, value]) => {
            localStorage.setItem(STORAGE_KEYS[key], value);
        });

        STATE.settings = settings;
    } catch (e) {
        console.error("Failed to save settings:", e);
    }
}

function resetToDefaults() {
    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
        localStorage.setItem(STORAGE_KEYS[key], value);
    });
    loadSettings();
}

// ─── GPU Detection ────────────────────────────────────────────────────

async function initGPUDetection() {
    if (window.detectGPU) {
        try {
            const gpuMode = await window.detectGPU();
            ELEMENTS.hardwareSelect.value = gpuMode;
            saveSettings();
        } catch (err) {
            console.error("GPU detection failed:", err);
        }
    }
}

// ─── Settings Accordion ───────────────────────────────────────────────

function toggleSettings() {
    ELEMENTS.settingsToggle.classList.toggle('open');
    ELEMENTS.settingsContent.classList.toggle('open');
}

// ─── Status UI ────────────────────────────────────────────────────────

function showStatus(text, percent) {
    ELEMENTS.statusText.textContent = text;
    ELEMENTS.progressFill.style.width = `${percent}%`;
    ELEMENTS.statusContainer.classList.remove('hidden');
}

function showError(text) {
    ELEMENTS.statusText.textContent = text;
    ELEMENTS.progressFill.style.width = '0%';
    setUIState('idle');
}

function setUIState(state) {
    switch (state) {
        case 'processing':
            STATE.isProcessing = true;
            ELEMENTS.btnGenerate.disabled = false;
            ELEMENTS.btnGenerate.textContent = 'ביטול תמלול (Cancel)';
            ELEMENTS.btnGenerate.style.background = 'linear-gradient(45deg, #e74c3c, #c0392b)';
            ELEMENTS.actionButtons.classList.add('hidden');
            break;
        case 'idle':
        default:
            STATE.isProcessing = false;
            ELEMENTS.btnGenerate.disabled = false;
            ELEMENTS.btnGenerate.textContent = 'צור כתוביות עכשיו';
            ELEMENTS.btnGenerate.style.background = ''; // reset to default
            break;
    }
}

// --------------------------------------------------------------------------------------------------------------------
// --- Main Generation Flow -------------------------------------------------------------------------------------------

async function onGenerateClick() {
    if (STATE.isProcessing) {
        if (window.cancelTranscription) {
            window.cancelTranscription();
        }
        return;
    }

    const settings = getCurrentSettings();
    STATE.currentModel = settings.model;

    setUIState('processing');
    showStatus('מייצא אודיו מפרמייר (ברקע שקט)...', 10);

    try {
        // 1. Export audio from Premiere
        const exportResult = await exportAudioFromPremiere(STATE.currentRange);
        const [audioPath, startSeconds] = parseExportResult(exportResult);

        // 2. Process audio with whisper.cpp
        showStatus('מוודא שמנוע ה-AI והמודל קיימים...', 30);

        const srtPath = await window.nodeProcessAudio(
            audioPath,
            settings.model,
            settings.hardware,
            parseInt(settings.words),
            settings.stripPunct,
            settings.lang,
            settings.translate,
            (status, percent) => showStatus(status, percent)
        );

        STATE.lastSrtPath = srtPath;

        // 3. Import SRT back to Premiere
        showStatus('מייבא כתוביות לפרמייר...', 90);
        await importSrtToPremiere(srtPath, startSeconds);

        // 4. Add emoji clips if a plan was generated
        try {
            var planPath = srtPath + ".emoji.json";
            if (fs.existsSync(planPath)) {
                showStatus("מוסיף אימוג'ים...", 95);
                var plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
                var emojiItems = [];
                for (var pi = 0; pi < (plan || []).length; pi++) {
                    var png = ensureEmojiPng(plan[pi].emoji);
                    if (png) emojiItems.push({ png: png, start: startSeconds + plan[pi].start, end: startSeconds + plan[pi].end });
                }
                if (emojiItems.length) {
                    var emCfg = readEmojiCfg();
                    var emPayload = {
                        items: emojiItems,
                        pos: (emCfg.pos && emCfg.pos.length === 2) ? emCfg.pos : null,
                        scale: (typeof emCfg.scale === "number") ? emCfg.scale : null
                    };
                    csInterface.evalScript(`lcPlaceEmojiPngs('${JSON.stringify(emPayload).replace(/'/g, "\\\\'")}')`);
                }
            }
        } catch (eEmoji) { 
            console.error("Emoji error:", eEmoji); 
        }

        // 4. Success
        showStatus('מוכן! 🎉', 100);
        setTimeout(() => {
            ELEMENTS.actionButtons.classList.remove('hidden');
            setUIState('idle');
        }, 1000);

    } catch (error) {
        if (error && error.message === 'Cancelled by user') {
            console.log("Transcription cancelled.");
            showStatus('התמלול בוטל', 0);
            setTimeout(() => { setUIState('idle'); }, 1000);
        } else {
            console.error("Transcription Error:", error);
            showError(`שגיאה: ${error.message}`);
        }
    }
}

function getCurrentSettings() {
    return {
        words: ELEMENTS.wordsSelect.value,
        lang: ELEMENTS.langSelect.value,
        model: ELEMENTS.modelSelect.value,
        hardware: ELEMENTS.hardwareSelect.value,
        stripPunct: ELEMENTS.stripPunct.checked,
        translate: ELEMENTS.translateEn.checked
    };
}

function parseExportResult(result) {
    if (result === 'ERROR: PRESET_MISSING') {
        throw new Error("לא נמצא קובץ הגדרות WAV במערכת.");
    }
    if (result.startsWith('ERROR') || result === "false") {
        throw new Error("לא נמצא ציר זמן או שגיאה בייצוא: " + result);
    }
    const parts = result.split("|");
    return [parts[0], parts.length > 1 ? parseFloat(parts[1]) : 0];
}

// ─── Premiere Integration ──────────────────────────────────────────────

function exportAudioFromPremiere(range) {
    return new Promise((resolve) => {
        csInterface.evalScript(`exportActiveTimelineAudio("${range}")`, resolve);
    });
}

function importSrtToPremiere(srtPath, startSeconds) {
    return new Promise((resolve) => {
        const escapedPath = srtPath.replace(/\\/g, '\\\\');
        const script = `importSrtToTimeline("${escapedPath}", ${startSeconds || 0})`;
        csInterface.evalScript(script, resolve);
    });
}

// ─── Action Buttons ────────────────────────────────────────────────────

function onOpenSrt() {
    if (!STATE.lastSrtPath) return;
    const cp = require('child_process');
    cp.exec(`start "" "${STATE.lastSrtPath}"`);
}

function onShowSrt() {
    if (!STATE.lastSrtPath) return;
    const cp = require('child_process');
    cp.exec(`explorer /select,"${STATE.lastSrtPath}"`);
}
