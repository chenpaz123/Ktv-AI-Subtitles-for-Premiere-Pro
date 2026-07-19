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
    var outputPath = outFolder + "\\" + cleanSeqName + "_ktv_" + new Date().getTime() + ".wav";
    
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

var LC_TICKS_PER_SECOND = 254016000000;

function lcEsc(s) {
    s = String(s);
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c === "\\") out += "\\\\";
        else if (c === "\"") out += "\\\"";
        else if (c === "\n") out += "\\n";
        else if (c === "\r") out += "\\r";
        else if (c === "\t") out += "\\t";
        else out += c;
    }
    return out;
}

function lcErr(msg) {
    return "{\"ok\":false,\"error\":\"" + lcEsc(msg) + "\"}";
}

function lcTicksToSeconds(ticks) {
    var t = parseFloat(ticks);
    if (isNaN(t)) return 0;
    return t / LC_TICKS_PER_SECOND;
}

function lcFindOrCreateBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var item = root.children[i];
        if (item.type === ProjectItemType.BIN && item.name === name) return item;
    }
    return root.createBin(name);
}

function lcMotionProps(clip) {
    var out = { pos: null, scale: null };
    try {
        var comps = clip.components;
        for (var j = 0; j < comps.numItems; j++) {
            if (comps[j].matchName !== "AE.ADBE Motion" && comps[j].displayName !== "Motion") continue;
            var props = comps[j].properties;
            for (var k = 0; k < props.numItems; k++) {
                if (props[k].displayName === "Position") out.pos = props[k];
                else if (props[k].displayName === "Scale") out.scale = props[k];
            }
            if (!out.pos && props.numItems > 0) out.pos = props[0];
            if (!out.scale && props.numItems > 1) out.scale = props[1];
            break;
        }
    } catch (e) { }
    return out;
}

function lcPlaceEmojiPngs(itemsJson) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return lcErr("no_sequence");
        var items, ovPos = null, ovScale = null;
        try {
            var payload = eval("(" + itemsJson + ")");
            if (payload && payload.items) {
                items = payload.items;
                if (payload.pos && payload.pos.length >= 2) ovPos = payload.pos;
                if (typeof payload.scale === "number") ovScale = payload.scale;
            } else { items = payload; }
        } catch (ePar) { return lcErr("bad_items_json"); }
        if (!items || !items.length) return lcErr("no_items");

        var W = 1920, H = 1080;
        try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (eFs) { }

        var bin = lcFindOrCreateBin("Ktv Emojis");
        var byName = {};
        var i, j;
        for (i = 0; i < bin.children.numItems; i++) byName[bin.children[i].name] = bin.children[i];

        var toImport = [];
        for (i = 0; i < items.length; i++) {
            var f = new File(items[i].png);
            if (!f.exists) { items[i]._name = null; continue; }
            items[i]._name = f.name;
            if (!byName[f.name]) {
                var dup = false;
                for (j = 0; j < toImport.length; j++) if (toImport[j] === f.fsName) { dup = true; break; }
                if (!dup) toImport.push(f.fsName);
            }
        }
        if (toImport.length) {
            app.project.importFiles(toImport, true, bin, false);
            for (i = 0; i < bin.children.numItems; i++) byName[bin.children[i].name] = bin.children[i];
        }

        var vts = seq.videoTracks;
        var track = vts[vts.numTracks - 1];
        if (track.clips.numItems > 0) {
            try {
                app.enableQE();
                var qeSeq = qe.project.getActiveSequence();
                try { qeSeq.addTracks(1, vts.numTracks, 0, 0); } catch (eSig) { qeSeq.addTracks(1); }
            } catch (eQe) { }
            vts = seq.videoTracks;
            track = vts[vts.numTracks - 1];
        }

        var placed = 0, skipped = 0;
        for (i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it._name || !byName[it._name]) continue;
            var startS = parseFloat(it.start), endS = parseFloat(it.end);
            track.overwriteClip(byName[it._name], startS);
            var clip = null;
            for (j = 0; j < track.clips.numItems; j++) {
                if (Math.abs(track.clips[j].start.seconds - startS) < 0.02) { clip = track.clips[j]; break; }
            }
            if (clip) {
                try { var tEnd = new Time(); tEnd.seconds = endS; clip.end = tEnd; } catch (e) {}
                try {
                    var mp = lcMotionProps(clip);
                    if (mp.pos) {
                        if (ovPos) mp.pos.setValue(ovPos, 1);
                        else mp.pos.setValue([0.5, 0.78], 1);
                    }
                    if (mp.scale) {
                        mp.scale.setValue(ovScale !== null ? ovScale : Math.round((H * 0.12) / 256 * 100), 1);
                    }
                } catch (e) {}
            }
            placed++;
        }
        return "{\"ok\":true,\"placed\":" + placed + "}";
    } catch (e) { return lcErr("emoji: " + e); }
}

function lcPlaceEmojiTarget(pngPath) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return lcErr("no_sequence");
        var f = new File(pngPath);
        if (!f.exists) return lcErr("png_not_found");
        
        var bin = lcFindOrCreateBin("Ktv Emojis");
        var item = null;
        for (var i = 0; i < bin.children.numItems; i++) if (bin.children[i].name === f.name) { item = bin.children[i]; break; }
        if (!item) {
            app.project.importFiles([f.fsName], true, bin, false);
            for (var i = 0; i < bin.children.numItems; i++) if (bin.children[i].name === f.name) { item = bin.children[i]; break; }
        }
        if (!item) return lcErr("import_failed");

        var vts = seq.videoTracks;
        var track = vts[vts.numTracks - 1];
        if (track.clips.numItems > 0) {
            try {
                app.enableQE();
                var qeSeq = qe.project.getActiveSequence();
                try { qeSeq.addTracks(1, vts.numTracks, 0, 0); } catch (eSig) { qeSeq.addTracks(1); }
            } catch (eQe) { }
            vts = seq.videoTracks;
            track = vts[vts.numTracks - 1];
        }
        track.overwriteClip(item, 0);
        return "{\"ok\":true}";
    } catch (e) { return lcErr("target: " + e); }
}

function lcApplyEmojiTargetToAll(targetName) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return lcErr("no_sequence");
        var vts = seq.videoTracks;
        var i, j, target = null;
        for (i = vts.numTracks - 1; i >= 0 && !target; i--) {
            var tr = vts[i];
            for (j = 0; j < tr.clips.numItems; j++) {
                var nm = tr.clips[j].projectItem ? tr.clips[j].projectItem.name : "";
                if (nm === targetName) { target = tr.clips[j]; break; }
            }
        }
        if (!target) return lcErr("target_not_found");

        var mp = lcMotionProps(target);
        var pos = null, scale = null;
        try { pos = mp.pos.getValue(); } catch (eP) { }
        try { scale = mp.scale ? mp.scale.getValue() : null; } catch (eS) { }

        var applied = 0;
        for (i = 0; i < vts.numTracks; i++) {
            var tr2 = vts[i];
            for (j = 0; j < tr2.clips.numItems; j++) {
                var cc = tr2.clips[j];
                var nm2 = cc.projectItem ? cc.projectItem.name : "";
                if (!nm2 || nm2.indexOf("emoji_") !== 0 || nm2 === targetName) continue;
                var mp2 = lcMotionProps(cc);
                try {
                    if (mp2.pos) {
                        mp2.pos.setValue(pos, 1);
                        if (scale !== null && mp2.scale) mp2.scale.setValue(scale, 1);
                        applied++;
                    }
                } catch (eA) { }
            }
        }
        for (i = vts.numTracks - 1; i >= 0; i--) {
            var tr3 = vts[i];
            for (j = tr3.clips.numItems - 1; j >= 0; j--) {
                var nm3 = tr3.clips[j].projectItem ? tr3.clips[j].projectItem.name : "";
                if (nm3 === targetName) { try { tr3.clips[j].remove(false, false); } catch (eR) { } }
            }
        }
        return "{\"ok\":true,\"pos\":[" + pos[0] + "," + pos[1] + "],\"scale\":" + (scale === null ? "null" : scale) + "}";
    } catch (e) { return lcErr("apply: " + e); }
}
