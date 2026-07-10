const fs = require('fs');
const path = require('path');

// Mock browser environment
global.window = {};

// Load node_bridge.js
const bridgeCode = fs.readFileSync(path.join(__dirname, 'js/node_bridge.js'), 'utf8');
eval(bridgeCode);

async function runTest() {
    console.log("Starting Simulation...");
    const hardwareMode = 'nvidia'; // Or 'cpu'
    
    // We will use one of the wav files from temp
    const audioPath = 'C:\\\\Users\\\\User\\\\Desktop\\\\subs\\\\subli_audio_1783685552278.wav';
    console.log("Using audio:", audioPath);

    const isTranslate = false;
    const modelName = 'ivrit-ai-2-ggml.bin';
    const maxWords = 42;
    const stripPunctuation = false;
    const lang = 'he';

    const statusCb = (status, progress) => {
        console.log(`[STATUS] ${status} (${progress}%)`);
    };

    try {
        console.log("Test 1: Hebrew Transcription (Ivrit model)");
        const srtPath1 = await window.nodeProcessAudio(audioPath, modelName, hardwareMode, maxWords, stripPunctuation, lang, false, statusCb);
        console.log("Generated SRT:", srtPath1);
        console.log("\n--- SRT CONTENT BEGIN ---");
        console.log(fs.readFileSync(srtPath1, 'utf8'));
        console.log("--- SRT CONTENT END ---\n");
        
        console.log("Simulation complete. You can view the file at: " + srtPath1);
    } catch (e) {
        console.error("Simulation failed:", e);
    }
}

runTest();
