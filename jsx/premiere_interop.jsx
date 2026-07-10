// Adobe ExtendScript for Premiere Pro

// Load External Object for CSXS Events
try {
    var xmpLib = new ExternalObject("lib:PlugPlugExternalObject");
} catch(e) {}

function getExtensionPath() {
    var extensionPath = $.fileName.split('/').slice(0, -2).join('/');
    return extensionPath;
}

function exportActiveTimelineAudio(rangeMode) {
    var proj = app.project;
    if (!proj) return "false";
    
    var seq = proj.activeSequence;
    if (!seq) return "false";

    var outFolder = Folder.temp.fsName;
    if (proj.path) {
        var projFile = new File(proj.path);
        if (projFile.exists && projFile.parent) {
            outFolder = projFile.parent.fsName;
        }
    }
    
    // Clean the sequence name to be safe for filenames
    var cleanSeqName = seq.name.replace(/[^a-zA-Z0-9_\u0590-\u05FF\-]/g, "_");
    var outputPath = outFolder + "\\" + cleanSeqName + "_subli_" + new Date().getTime() + ".wav";
    
    // Dynamically find Premiere's built-in 16kHz WAV preset (required by whisper.cpp)
    // Uses app.path so it works on any drive (C:, D:) and any version (2023, 2024, 2025)
    var presetPath = "";
    var possiblePaths = [
        app.path + "/Settings/EncoderPresets/WAV_Mono_16bit_16kHz.epr",
        app.path + "/Settings/EncoderPresets/RawPCM_mono_16khz_nometadata.epr",
        app.path + "/MediaIO/systempresets/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr"
    ];
    
    for (var i = 0; i < possiblePaths.length; i++) {
        var f = new File(possiblePaths[i]);
        if (f.exists) {
            presetPath = f.fsName;
            break;
        }
    }
    
    if (presetPath === "") {
        return "ERROR: PRESET_MISSING";
    }

    try {
        var exportFlag = app.encoder.ENCODE_ENTIRE;
        var inS = 0;
        
        if (rangeMode === "in_out") {
            exportFlag = app.encoder.ENCODE_IN_TO_OUT;
            try {
                inS = seq.getInPointAsTime().seconds;
            } catch (e1) {
                try {
                    inS = parseFloat(seq.getInPoint());
                } catch (e2) {}
            }
        }
        
        // exportAsMediaDirect renders silently inside Premiere without opening AME
        seq.exportAsMediaDirect(outputPath, presetPath, exportFlag);
        
        var f = new File(outputPath);
        if (f.exists) {
            return outputPath + "|" + inS;
        } else {
            return "ERROR: EXPORT_FAILED";
        }
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

function importSrtToTimeline(srtPath, startSeconds) {
    if (typeof startSeconds === 'undefined' || isNaN(startSeconds)) {
        startSeconds = 0;
    }
    
    var proj = app.project;
    if (!proj) return "false";
    
    var seq = proj.activeSequence;
    if (!seq) return "false";

    try {
        var importResult = proj.importFiles([srtPath], false, proj.rootItem, false);
        if (importResult) {
            // Wait a moment for import to finish
            $.sleep(1000); 
            
            var srtItem = null;
            for (var i = 0; i < proj.rootItem.children.numItems; i++) {
                var child = proj.rootItem.children[i];
                if (child.name === srtPath.split('\\').pop() || child.name === srtPath.split('/').pop()) {
                    srtItem = child;
                    break;
                }
            }
            
            // Note: Premiere's scripting API doesn't easily allow placing caption items 
            // directly onto the sequence at an arbitrary time in older versions. 
            // Most users drag it from the project bin, or we can use sequence.insertClip 
            // if the version supports caption tracks natively via API.
            if (srtItem) {
                if (typeof seq.createCaptionTrack === "function") {
                    try {
                        var fmt;
                        try { fmt = Sequence.CAPTION_FORMAT_SUBTITLE; } catch (eFmt) { fmt = undefined; }
                        if (fmt !== undefined) {
                            seq.createCaptionTrack(srtItem, startSeconds, fmt);
                        } else {
                            seq.createCaptionTrack(srtItem, startSeconds);
                        }
                    } catch (eCt) {
                        try { seq.createCaptionTrack(srtItem, startSeconds); } catch (e2) {}
                    }
                }
            }
            
            return "true";
        }
    } catch (e) {
        return "false";
    }
    
    return "false";
}
