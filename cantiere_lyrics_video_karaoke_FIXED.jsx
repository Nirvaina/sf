// Grenar_lyrics_video_generator.jsx
// After Effects ExtendScript - Karaoke Highlight + transcript file input + vertical wrapping
// Version: 1.2 (FIXED)
// Fixed bugs: karaoke/wrapping mismatch, syllabification, parser, overlapping layers, expression escaping
(function () {
    // ---------- DEFAULTS ----------
    var defaults = {
        compName: "Lyrics",
        compWidth: 1080,
        compHeight: 1920,
        compDuration: 240,
        frameRate: 30,
        pixelAspect: 1.0,

        fontName: "Arial-BoldMT",
        fontSize: 96,
        textColor: [1, 1, 1],
        highlightColor: [1, 0.85, 0.2],
        shadowColor: [0, 0, 0],
        shadowOpacity: 80,
        shadowDistance: 6,
        shadowSoftness: 12,

        fadeDuration: 0.25,
        lineSpacing: 120  // vertical spacing between simultaneous lines (pixels)
    };

    // ---------- HELPERS ----------

    // Custom JSON parser for ExtendScript versions without JSON.parse()
    function parseJSON(jsonString) {
        // Check if native JSON.parse exists
        if (typeof JSON !== 'undefined' && JSON.parse) {
            return JSON.parse(jsonString);
        }

        // Fallback: use eval() for older ExtendScript
        // Basic sanitization to prevent code injection
        var sanitized = jsonString.replace(/^\s+|\s+$/g, ""); // trim

        // Check if it looks like valid JSON (basic validation)
        if (!(sanitized.charAt(0) === '{' || sanitized.charAt(0) === '[')) {
            throw new Error("Invalid JSON: must start with { or [");
        }

        // Use eval to parse (this is how JSON was parsed before JSON.parse existed)
        try {
            return eval('(' + sanitized + ')');
        } catch (e) {
            throw new Error("JSON parse failed: " + e.toString());
        }
    }

    function safeStringForExpression(s) {
        if (s === null || s === undefined) s = "";
        s = s.toString();
        // Escape backslashes first, then quotes, then newlines
        s = s.replace(/\\/g, "\\\\");
        s = s.replace(/"/g, '\\"');
        s = s.replace(/'/g, "\\'");
        s = s.replace(/\r?\n/g, "\\n");
        s = s.replace(/\r/g, "\\r");
        s = s.replace(/\t/g, "\\t");
        return s;
    }

    // Improved syllabification that preserves spaces and punctuation
    function autoSyllabifyPreserve(text) {
        var vowels = "aeiouàèéìòùAEIOUÀÈÉÌÒÙ";
        var tokens = [];
        var i = 0;

        while (i < text.length) {
            var cur = "";
            var foundVowel = false;

            // Collect characters until we have a vowel + trailing consonants
            while (i < text.length) {
                var ch = text.charAt(i);
                cur += ch;
                i++;

                if (vowels.indexOf(ch) !== -1) {
                    foundVowel = true;
                    // Collect trailing consonants
                    while (i < text.length) {
                        var nextCh = text.charAt(i);
                        if (nextCh === ' ') {
                            // Include one trailing space with the syllable
                            cur += nextCh;
                            i++;
                            break;
                        } else if (vowels.indexOf(nextCh) !== -1) {
                            // Stop before next vowel
                            break;
                        } else {
                            // Consonant - add it
                            cur += nextCh;
                            i++;
                        }
                    }
                    break;
                } else if (ch === ' ') {
                    // Space before any vowel - keep with current token
                    break;
                }
            }

            if (cur.length > 0) {
                tokens.push(cur);
            }
        }

        // Fallback: if no tokens found, split by words
        if (tokens.length === 0) {
            var words = text.split(/(\s+)/);
            for (var w = 0; w < words.length; w++) {
                if (words[w].length > 0) {
                    tokens.push(words[w]);
                }
            }
        }

        // Ultimate fallback: return whole text
        if (tokens.length === 0) {
            tokens = [text];
        }

        return tokens;
    }

    // Wrap text into multiple lines based on max chars
    function wrapTextByChars(text, maxCharsPerLine) {
        if (!text || text.length === 0) return "";
        if (maxCharsPerLine <= 0) return text;

        var words = text.split(/(\s+)/); // include spaces as tokens
        var lines = [];
        var cur = "";

        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (!w) continue;

            var newLen = cur.length + w.length;

            if (cur.length === 0) {
                // First word on line
                if (w.length > maxCharsPerLine) {
                    // Word too long - force split
                    var start = 0;
                    while (start < w.length) {
                        var chunk = w.substr(start, maxCharsPerLine);
                        lines.push(chunk);
                        start += maxCharsPerLine;
                    }
                } else {
                    cur = w;
                }
            } else if (newLen <= maxCharsPerLine) {
                cur += w;
            } else {
                // Would exceed limit - start new line
                if (cur.length > 0) {
                    lines.push(cur);
                }
                cur = w;
            }
        }

        if (cur.length > 0) {
            lines.push(cur);
        }

        return lines.join("\n");
    }

    // Calculate approximate max chars per line
    function estimateMaxChars(compWidth, fontSize, horizPaddingPercent) {
        var usable = compWidth * (1 - horizPaddingPercent);
        var charWidth = fontSize * 0.6; // approximate
        var maxChars = Math.floor(usable / charWidth);
        return Math.max(5, maxChars); // minimum 5 chars
    }

    // ---------- GUI ----------
    function buildUI() {
        var w = new Window("palette", "Cantiere Karaoke Builder", undefined);
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.margins = 10;

        // Row: file + browse button
        var grpFile = w.add("group");
        grpFile.orientation = "row";
        grpFile.add("statictext", undefined, "Transcript (JSON):");
        var filePath = grpFile.add("edittext", undefined, "");
        filePath.characters = 32;
        var browseBtn = grpFile.add("button", undefined, "Scegli file...");

        browseBtn.onClick = function () {
            var f = File.openDialog("Seleziona il file transcript (JSON)", "*.txt;*.json;*.*");
            if (f) {
                filePath.text = f.fsName;
            }
        };

        var grpOrientation = w.add("group");
        grpOrientation.orientation = "row";
        var verticalChk = grpOrientation.add("checkbox", undefined, "Video verticale (portrait)");
        verticalChk.value = true;

        // Comp settings
        var grpComp = w.add("group");
        grpComp.orientation = "row";
        grpComp.add("statictext", undefined, "Nome comp:");
        var compNameInput = grpComp.add("edittext", undefined, defaults.compName);
        compNameInput.characters = 22;

        var grpRes = w.add("group");
        grpRes.orientation = "row";
        grpRes.add("statictext", undefined, "W:");
        var wInput = grpRes.add("edittext", undefined, defaults.compWidth.toString());
        wInput.characters = 6;
        grpRes.add("statictext", undefined, "H:");
        var hInput = grpRes.add("edittext", undefined, defaults.compHeight.toString());
        hInput.characters = 6;
        grpRes.add("statictext", undefined, "Dur(s):");
        var durInput = grpRes.add("edittext", undefined, defaults.compDuration.toString());
        durInput.characters = 6;
        grpRes.add("statictext", undefined, "FPS:");
        var fpsInput = grpRes.add("edittext", undefined, defaults.frameRate.toString());
        fpsInput.characters = 4;

        // Font & size
        var grpFont = w.add("group");
        grpFont.orientation = "row";
        grpFont.add("statictext", undefined, "Font:");
        var fontInput = grpFont.add("edittext", undefined, defaults.fontName);
        fontInput.characters = 24;
        grpFont.add("statictext", undefined, "Size:");
        var fontSizeInput = grpFont.add("edittext", undefined, defaults.fontSize.toString());
        fontSizeInput.characters = 4;

        // Karaoke options
        var grpKaraoke = w.add("group");
        grpKaraoke.orientation = "row";
        grpKaraoke.add("statictext", undefined, "Colore karaoke (RGB 0-255):");
        var karaokeR = grpKaraoke.add("edittext", undefined, Math.round(defaults.highlightColor[0] * 255).toString());
        karaokeR.characters = 3;
        var karaokeG = grpKaraoke.add("edittext", undefined, Math.round(defaults.highlightColor[1] * 255).toString());
        karaokeG.characters = 3;
        var karaokeB = grpKaraoke.add("edittext", undefined, Math.round(defaults.highlightColor[2] * 255).toString());
        karaokeB.characters = 3;

        var grpFade = w.add("group");
        grpFade.orientation = "row";
        var fadeChk = grpFade.add("checkbox", undefined, "Abilita fade in/out");
        fadeChk.value = true;

        // Buttons
        var btnGroup = w.add("group");
        btnGroup.orientation = "row";
        btnGroup.alignment = "center";
        var createBtn = btnGroup.add("button", undefined, "Crea Lyrics Comp");
        var cancelBtn = btnGroup.add("button", undefined, "Chiudi");

        cancelBtn.onClick = function () { w.close(); };

        createBtn.onClick = function () {
            if (!filePath.text) {
                alert("Seleziona prima il file transcript.");
                return;
            }
            var cfg = {
                transcriptPath: filePath.text,
                compName: compNameInput.text || defaults.compName,
                compWidth: parseInt(wInput.text, 10) || defaults.compWidth,
                compHeight: parseInt(hInput.text, 10) || defaults.compHeight,
                compDuration: parseFloat(durInput.text) || defaults.compDuration,
                frameRate: parseFloat(fpsInput.text) || defaults.frameRate,
                fontName: fontInput.text || defaults.fontName,
                fontSize: parseFloat(fontSizeInput.text) || defaults.fontSize,
                vertical: verticalChk.value,
                useFade: fadeChk.value,
                highlightColor: [
                    parseInt(karaokeR.text, 10) / 255.0 || defaults.highlightColor[0],
                    parseInt(karaokeG.text, 10) / 255.0 || defaults.highlightColor[1],
                    parseInt(karaokeB.text, 10) / 255.0 || defaults.highlightColor[2]
                ]
            };

            // Validate config
            if (cfg.compWidth <= 0 || cfg.compHeight <= 0) {
                alert("Larghezza e altezza devono essere maggiori di zero.");
                return;
            }
            if (cfg.compDuration <= 0 || cfg.frameRate <= 0) {
                alert("Durata e frame rate devono essere maggiori di zero.");
                return;
            }
            if (cfg.fontSize <= 0) {
                alert("Font size deve essere maggiore di zero.");
                return;
            }

            w.close();
            try {
                createProjectAndComp(cfg);
            } catch (e) {
                alert("Errore: " + e.toString() + "\n\nStack: " + (e.line ? "Line " + e.line : "N/A"));
            }
        };

        w.center();
        w.show();
    }

    // ---------- READ & PARSE TRANSCRIPT ----------
    function readTranscript(path) {
        var f = new File(path);
        if (!f.exists) throw new Error("File non trovato: " + path);
        if (!f.open("r")) throw new Error("Impossibile aprire il file: " + path);
        var content = f.read();
        f.close();

        if (!content || content.length === 0) {
            throw new Error("Il file è vuoto.");
        }

        // Try JSON first
        var jsonError = null;
        var debugInfo = "";
        try {
            var j = parseJSON(content);
            debugInfo += "JSON parsed successfully.\n";

            if (j.chunks) {
                debugInfo += "Found 'chunks' property.\n";
                var result = [];
                var chunksArray = j.chunks;

                // Simple array iteration - most compatible way
                var arrayLength = 0;
                try {
                    arrayLength = chunksArray.length;
                } catch (e) {
                    // If .length fails, try counting
                    for (var k in chunksArray) {
                        if (chunksArray.hasOwnProperty(k) && !isNaN(parseInt(k, 10))) {
                            arrayLength++;
                        }
                    }
                }

                debugInfo += "Array length: " + arrayLength + "\n";

                if (arrayLength > 0) {
                    for (var i = 0; i < arrayLength; i++) {
                        var c = chunksArray[i];
                        if (!c) {
                            debugInfo += "Chunk " + i + ": null/undefined\n";
                            continue;
                        }

                        // Check each field separately for debugging
                        if (!c.text) {
                            debugInfo += "Chunk " + i + ": missing text\n";
                            continue;
                        }
                        if (!c.timestamp) {
                            debugInfo += "Chunk " + i + ": missing timestamp\n";
                            continue;
                        }

                        // Check timestamp array
                        var ts0 = c.timestamp[0];
                        var ts1 = c.timestamp[1];
                        if (ts0 === undefined || ts1 === undefined) {
                            debugInfo += "Chunk " + i + ": invalid timestamp array\n";
                            continue;
                        }

                        var startTime = parseFloat(ts0);
                        var endTime = parseFloat(ts1);

                        if (isNaN(startTime) || isNaN(endTime)) {
                            debugInfo += "Chunk " + i + ": timestamp values are NaN (" + ts0 + ", " + ts1 + ")\n";
                            continue;
                        }

                        debugInfo += "Chunk " + i + ": OK (\"" + c.text.substr(0, 30) + "...\")\n";
                        result.push({
                            text: c.text.toString(),
                            start: startTime,
                            end: endTime
                        });
                    }
                }

                debugInfo += "Total valid chunks: " + result.length + "\n";
                if (result.length > 0) return result;
            } else {
                debugInfo += "No 'chunks' property found in JSON.\n";
            }
        } catch (e) {
            jsonError = e.toString();
            debugInfo += "JSON parse error: " + jsonError + "\n";
        }

        // -------- CUSTOM YAML-LIKE PARSER --------
        var lines = content.split(/\r?\n/);
        var chunks = [];
        var current = null;

        for (var i = 0; i < lines.length; i++) {
            var raw = lines[i];
            if (typeof raw !== "string") continue;

            var ln = raw.replace(/^\s+/, "").replace(/\s+$/, ""); // trim

            if (ln.length === 0) continue; // skip empty lines

            // Start of new chunk: "- text:"
            if (ln.match(/^-\s*text\s*:/i)) {
                // Save previous chunk if valid
                if (current && current.text && current.end > current.start) {
                    chunks.push(current);
                }

                current = { text: "", start: 0, end: 0 };

                var txt = ln.replace(/^-\s*text\s*:\s*/i, "");
                txt = txt.replace(/^["']|["']$/g, ""); // remove quotes
                current.text = txt;
                continue;
            }

            // Line "text:" (without dash)
            if (ln.match(/^text\s*:/i)) {
                if (!current) {
                    current = { text: "", start: 0, end: 0 };
                }
                var txt2 = ln.replace(/^text\s*:\s*/i, "");
                txt2 = txt2.replace(/^["']|["']$/g, "");
                current.text = txt2;
                continue;
            }

            // Line "timestamp:"
            if (ln.match(/^timestamp\s*:/i)) {
                if (!current) {
                    current = { text: "", start: 0, end: 0 };
                }
                var t = ln.replace(/^timestamp\s*:\s*/i, "");
                t = t.replace(/[\[\]]/g, ""); // remove brackets
                var parts = t.split(",");
                if (parts.length >= 2) {
                    var s = parseFloat(parts[0]);
                    var e = parseFloat(parts[1]);
                    if (!isNaN(s) && !isNaN(e)) {
                        current.start = s;
                        current.end = e;
                    }
                }
                continue;
            }
        }

        // Push final chunk if valid
        if (current && current.text && current.end > current.start) {
            chunks.push(current);
        }

        if (chunks.length === 0) {
            throw new Error(
                "Nessun chunk valido trovato nel file.\n\n" +
                "DEBUG INFO:\n" + debugInfo + "\n" +
                "Il file deve essere in formato JSON con struttura:\n" +
                '{\n  "chunks": [\n    {"text": "...", "timestamp": [inizio, fine]}\n  ]\n}\n\n' +
                "Oppure formato YAML:\n" +
                "- text: \"...\"\n  timestamp: [inizio, fine]"
            );
        }

        return chunks;
    }

    // ---------- MAIN CREATION ----------
    function createProjectAndComp(cfg) {
        app.beginUndoGroup("Create Cantiere Karaoke Lyrics Video");

        try {
            if (!app.project) app.newProject();

            var comp = app.project.items.addComp(
                cfg.compName,
                cfg.compWidth,
                cfg.compHeight,
                defaults.pixelAspect,
                cfg.compDuration,
                cfg.frameRate
            );

            // Background solid
            var bg = comp.layers.addSolid(
                [0.05, 0.05, 0.05],
                "Background",
                cfg.compWidth,
                cfg.compHeight,
                defaults.pixelAspect,
                cfg.compDuration
            );
            bg.locked = true;

            // Read transcript
            var chunks = readTranscript(cfg.transcriptPath);
            if (chunks.length === 0) {
                alert("Nessun chunk trovato nel transcript.");
                app.endUndoGroup();
                return;
            }

            // Estimate wrapping parameters if vertical
            var maxChars = 9999;
            if (cfg.vertical) {
                var horizPad = 0.15; // 15% horizontal padding
                maxChars = estimateMaxChars(cfg.compWidth, cfg.fontSize, horizPad);
            }

            // Track simultaneous lines for vertical offset
            var activeRanges = []; // array of {start, end, yOffset}

            // For each chunk create text + highlight
            for (var i = 0; i < chunks.length; i++) {
                var c = chunks[i];
                var txt = c.text;
                var start = c.start;
                var end = c.end;

                // Validate chunk
                if (!txt || txt.length === 0) continue;
                if (end <= start) {
                    end = start + 3.0; // default 3 second duration
                }
                var duration = end - start;
                if (duration < 0.02) continue; // skip too-short chunks

                // Wrap text if vertical
                var finalText = txt;
                if (cfg.vertical) {
                    finalText = wrapTextByChars(txt, maxChars);
                }

                // Calculate Y offset to avoid overlapping with simultaneous lines
                var yOffset = cfg.compHeight * 0.5; // center baseline
                var offsetIndex = 0;

                // Find how many lines are active at this time
                for (var j = 0; j < activeRanges.length; j++) {
                    var range = activeRanges[j];
                    // Check if this chunk overlaps with existing range
                    if (start < range.end && end > range.start) {
                        offsetIndex++;
                    }
                }

                // Apply offset (alternate above/below center)
                if (offsetIndex > 0) {
                    var direction = (offsetIndex % 2 === 0) ? 1 : -1;
                    var offset = Math.ceil(offsetIndex / 2) * defaults.lineSpacing;
                    yOffset += direction * offset;
                }

                // Store this range
                activeRanges.push({ start: start, end: end, yOffset: yOffset });

                // Create base text layer
                var baseLayer = comp.layers.addText(finalText);
                baseLayer.name = "Line " + (i + 1) + " - base";
                var baseTextProp = baseLayer.property("Source Text");
                var baseDoc = baseTextProp.value;
                baseDoc.font = cfg.fontName;
                baseDoc.fontSize = cfg.fontSize;
                baseDoc.fillColor = defaults.textColor;
                baseDoc.applyFill = true;
                baseDoc.applyStroke = false;
                baseDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
                baseDoc.text = finalText;
                baseTextProp.setValue(baseDoc);

                // Position
                var posX = cfg.compWidth / 2;
                var posY = yOffset;
                baseLayer.property("Transform").property("Position").setValue([posX, posY]);

                // In/out points
                baseLayer.startTime = start;
                baseLayer.outPoint = end;

                // Add drop shadow (use try/catch for compatibility)
                try {
                    var ds = baseLayer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
                    if (ds) {
                        // Use property names instead of indices for compatibility
                        try {
                            ds.property("Shadow Color").setValue(defaults.shadowColor);
                        } catch (e) {
                            ds.property(1).setValue(defaults.shadowColor);
                        }
                        try {
                            ds.property("Opacity").setValue(defaults.shadowOpacity);
                        } catch (e) {
                            ds.property(2).setValue(defaults.shadowOpacity);
                        }
                        try {
                            ds.property("Direction").setValue(90);
                        } catch (e) {
                            ds.property(3).setValue(90);
                        }
                        try {
                            ds.property("Distance").setValue(defaults.shadowDistance);
                        } catch (e) {
                            ds.property(4).setValue(defaults.shadowDistance);
                        }
                        try {
                            ds.property("Softness").setValue(defaults.shadowSoftness);
                        } catch (e) {
                            ds.property(5).setValue(defaults.shadowSoftness);
                        }
                    }
                } catch (e) {
                    // Drop shadow failed - continue without it
                }

                // Fade in/out (if enabled)
                if (cfg.useFade) {
                    var opacity = baseLayer.property("Transform").property("Opacity");
                    var fade = defaults.fadeDuration;
                    opacity.setValueAtTime(start, 0);
                    opacity.setValueAtTime(Math.min(start + fade, end - 0.01), 100);
                    if (end < cfg.compDuration - 0.01) {
                        opacity.setValueAtTime(Math.max(start + fade + 0.01, end - fade), 100);
                        opacity.setValueAtTime(end, 0);
                    }
                }

                // Create highlight as BRAND NEW layer (not duplicate)
                // This avoids inheriting drop shadow, effects, and keyframes from base layer
                var hl = null;
                try {
                    hl = comp.layers.addText(finalText);  // Start with full text, not empty
                    hl.name = "Line " + (i + 1) + " - highlight";

                    // Position exactly same as base layer
                    hl.property("Transform").property("Position").setValue([posX, posY]);

                    // Set time range
                    hl.startTime = start;
                    hl.outPoint = end;

                    // Configure text properties for highlight
                    var hlTextProp = hl.property("Source Text");
                    var hlDoc = hlTextProp.value;
                    hlDoc.font = cfg.fontName;
                    hlDoc.fontSize = cfg.fontSize;
                    hlDoc.fillColor = cfg.highlightColor;
                    hlDoc.applyFill = true;
                    hlDoc.applyStroke = false;
                    hlDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
                    // Text will be filled progressively by expression
                    hlDoc.text = "";
                    hlTextProp.setValue(hlDoc);
                } catch (eHL) {
                    alert("ERRORE creazione highlight layer " + (i+1) + ":\n" + eHL.toString());
                    continue; // Skip this chunk if highlight creation fails
                }

                if (!hl) {
                    alert("Highlight layer non creato per chunk " + (i+1));
                    continue;
                }

                // CRITICAL FIX: Syllabify the WRAPPED text, not original
                // This ensures karaoke highlight matches what's displayed
                var sylls = autoSyllabifyPreserve(finalText);
                if (sylls.length === 0) sylls = [finalText];

                var syllDuration = duration / Math.max(1, sylls.length);

                // Build expression - escape strings properly
                var safeSyllArray = "[";
                for (var s = 0; s < sylls.length; s++) {
                    if (s > 0) safeSyllArray += ",";
                    safeSyllArray += '"' + safeStringForExpression(sylls[s]) + '"';
                }
                safeSyllArray += "]";

                var expr =
                    "var syll = " + safeSyllArray + ";\n" +
                    "var s = inPoint;\n" +
                    "var d = " + syllDuration.toFixed(6) + ";\n" +
                    "var t = time - s;\n" +
                    "var idx = Math.floor(t / d);\n" +
                    "if (idx < 0) idx = 0;\n" +
                    "if (idx > syll.length) idx = syll.length;\n" +
                    "var shown = \"\";\n" +
                    "for (var i = 0; i < idx; i++) {\n" +
                    "  shown += syll[i];\n" +
                    "}\n" +
                    "var td = value;\n" +
                    "td.text = shown;\n" +
                    "td;";

                try {
                    hlTextProp.expression = expr;
                } catch (eExpr) {
                    alert("ERRORE impostazione expression per chunk " + (i+1) + ":\n" + eExpr.toString() + "\n\nExpression:\n" + expr.substr(0, 200));
                }

                // Add glow to highlight (optional)
                try {
                    var glow = hl.property("ADBE Effect Parade").addProperty("ADBE Glow");
                    if (glow) {
                        try {
                            glow.property("Glow Threshold").setValue(50);
                        } catch (e) {
                            glow.property(1).setValue(50);
                        }
                        try {
                            glow.property("Glow Radius").setValue(15);
                        } catch (e) {
                            glow.property(2).setValue(15);
                        }
                        try {
                            glow.property("Glow Intensity").setValue(0.8);
                        } catch (e) {
                            glow.property(3).setValue(0.8);
                        }
                    }
                } catch (e) {
                    // Glow failed - continue without it
                }

            } // end for chunks

            // Clean up: remove temporary tracking arrays
            activeRanges = null;

            // DEBUG: Count layers
            var totalLayers = comp.layers.length;
            var highlightLayers = 0;
            var baseLayers = 0;
            for (var l = 1; l <= totalLayers; l++) {
                var layerName = comp.layer(l).name;
                if (layerName.indexOf("highlight") !== -1) {
                    highlightLayers++;
                } else if (layerName.indexOf("base") !== -1) {
                    baseLayers++;
                }
            }

            alert(
                "Composizione karaoke creata con successo!\n\n" +
                "Chunks processati: " + chunks.length + "\n" +
                "Layer totali nella comp: " + totalLayers + "\n" +
                "  - Base layers: " + baseLayers + "\n" +
                "  - Highlight layers: " + highlightLayers + "\n\n" +
                "Se vedi 0 highlight layers, c'è un problema!\n" +
                "Verifica il testo e i tempi nel pannello Timeline."
            );

        } catch (err) {
            alert("Errore durante la creazione:\n" + err.toString() + "\n\nLine: " + (err.line || "N/A"));
        } finally {
            app.endUndoGroup();
        }
    }

    // ---------- RUN ----------
    buildUI();

})();
