# After Effects Karaoke Script - Bug Report & Fixes

## Critical Bugs Fixed

### 1. **CRITICAL: Karaoke Highlight Text Mismatch**
**Location:** Line 241-243 (createProjectAndComp function)
**Severity:** Critical - Breaks karaoke functionality

**Problem:**
```javascript
// OLD CODE - BUGGY
var sylls = autoSyllabifyPreserve(txt);  // Uses ORIGINAL unwrapped text
```

The script syllabified the **original unwrapped text** but displayed **wrapped text** in the base layer. This caused:
- Karaoke highlight showing different text than what's visible
- Misaligned syllable progression
- Broken visual synchronization

**Fix:**
```javascript
// FIXED
var sylls = autoSyllabifyPreserve(finalText);  // Uses wrapped text that matches display
```

Now syllabification works on the same wrapped text that's displayed.

---

### 2. **Syllabification Algorithm Bug**
**Location:** Lines 44-77 (autoSyllabifyPreserve function)
**Severity:** High - Causes character skipping/duplication

**Problem:**
```javascript
// OLD CODE - BUGGY
for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    cur += ch;
    if (vowels.indexOf(ch) !== -1) {
        var j = i + 1;
        while (j < text.length && vowels.indexOf(text[j]) === -1 && text[j] !== ' ') {
            cur += text[j];
            j++;
        }
        if (j < text.length && text[j] === ' ') {
            cur += ' ';
            j++;
        }
        tokens.push(cur);
        cur = "";
        i = j - 1;  // BUG: Loop counter manipulation causes skipped/duplicate chars
    }
}
```

The `i = j - 1` manipulation was fragile and could skip characters when spaces were involved.

**Fix:**
Complete rewrite using a while loop with explicit index control:
```javascript
var i = 0;
while (i < text.length) {
    var cur = "";
    // ... collect syllable explicitly
    i++;  // Controlled advancement
}
```

---

### 3. **Layer Overlap Issue**
**Location:** Lines 230-232 (createProjectAndComp function)
**Severity:** Medium - Poor visual presentation

**Problem:**
```javascript
// OLD CODE - BUGGY
var yOffset = cfg.compHeight * 0.5;
var posY = yOffset;  // All layers at same Y position!
// Comment says "Slight vertical offset" but code doesn't implement it
```

All simultaneous lyrics rendered at the exact same position, causing overlapping text.

**Fix:**
Added proper overlap detection and vertical offsetting:
```javascript
var activeRanges = []; // Track simultaneous lines
// ... for each chunk:
var offsetIndex = 0;
for (var j = 0; j < activeRanges.length; j++) {
    if (start < range.end && end > range.start) {
        offsetIndex++;
    }
}
// Apply alternating offset above/below center
if (offsetIndex > 0) {
    var direction = (offsetIndex % 2 === 0) ? 1 : -1;
    var offset = Math.ceil(offsetIndex / 2) * defaults.lineSpacing;
    yOffset += direction * offset;
}
```

---

### 4. **Inadequate String Escaping for Expressions**
**Location:** Lines 21-26 (safeStringForExpression function)
**Severity:** High - Expression breaks with special chars

**Problem:**
```javascript
// OLD CODE - INCOMPLETE
function safeStringForExpression(s) {
    if (s === null || s === undefined) s = "";
    return s.toString().replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}
```

Missing escapes for: single quotes, tabs, carriage returns.

**Fix:**
```javascript
function safeStringForExpression(s) {
    if (s === null || s === undefined) s = "";
    s = s.toString();
    s = s.replace(/\\/g, "\\\\");  // Backslash first
    s = s.replace(/"/g, '\\"');
    s = s.replace(/'/g, "\\'");     // NEW: Single quotes
    s = s.replace(/\r?\n/g, "\\n");
    s = s.replace(/\r/g, "\\r");    // NEW: Carriage return
    s = s.replace(/\t/g, "\\t");    // NEW: Tabs
    return s;
}
```

---

### 5. **Expression Array Building Bug**
**Location:** Lines 266-268 (createProjectAndComp function)
**Severity:** High - Could break with special characters

**Problem:**
```javascript
// OLD CODE - UNSAFE
var safeSyllArray = JSON.stringify(sylls);
var expr = "var syll = " + safeSyllArray + ";\n" + ...
```

`JSON.stringify()` might not be available in all ExtendScript versions, and doesn't handle all edge cases.

**Fix:**
Manual array construction with proper escaping:
```javascript
var safeSyllArray = "[";
for (var s = 0; s < sylls.length; s++) {
    if (s > 0) safeSyllArray += ",";
    safeSyllArray += '"' + safeStringForExpression(sylls[s]) + '"';
}
safeSyllArray += "]";
```

---

### 6. **Parser Fragility**
**Location:** Lines 186-239 (readTranscript function)
**Severity:** Medium - Could fail on valid input

**Problems:**
- No validation of parsed chunks before adding to array
- Empty chunks added to results
- No check if text exists or timestamps are valid

**Fix:**
Added validation throughout:
```javascript
// Skip invalid chunks during JSON parsing
if (!c.text || !c.timestamp || c.timestamp.length < 2) {
    continue;
}

// Validate before pushing in custom parser
if (current && current.text && current.end > current.start) {
    chunks.push(current);
}

// Final validation
if (chunks.length === 0) {
    throw new Error("Nessun chunk valido trovato nel file.");
}
```

---

### 7. **Drop Shadow Property Access**
**Location:** Lines 198-207 (createProjectAndComp function)
**Severity:** Low - Compatibility issue

**Problem:**
```javascript
// OLD CODE - VERSION DEPENDENT
ds.property(1).setValue(defaults.shadowColor);  // Hardcoded indices
ds.property(2).setValue(defaults.shadowOpacity);
```

Hardcoded property indices can fail in different AE versions.

**Fix:**
Try property names first, fallback to indices:
```javascript
try {
    ds.property("Shadow Color").setValue(defaults.shadowColor);
} catch (e) {
    ds.property(1).setValue(defaults.shadowColor);
}
```

---

### 8. **Missing Input Validation**
**Location:** Lines 143-145 (buildUI function)
**Severity:** Low - Poor user experience

**Problem:**
No validation of user input before creating composition.

**Fix:**
Added validation after config creation:
```javascript
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
```

---

### 9. **Text Wrapping Edge Cases**
**Location:** Lines 80-115 (wrapTextByChars function)
**Severity:** Low - Edge case handling

**Problems:**
- No handling of empty text input
- No validation of maxCharsPerLine
- Could create empty lines

**Fix:**
Added validation:
```javascript
function wrapTextByChars(text, maxCharsPerLine) {
    if (!text || text.length === 0) return "";
    if (maxCharsPerLine <= 0) return text;
    // ... rest of function
    if (!w) continue;  // Skip empty tokens
}
```

---

### 10. **Improved Error Messages**
**Location:** Multiple locations
**Severity:** Low - Developer experience

**Fix:**
Enhanced error messages with context:
```javascript
// OLD
} catch (e) {
    alert("Errore: " + e.toString());
}

// NEW
} catch (e) {
    alert("Errore: " + e.toString() + "\n\nStack: " + (e.line ? "Line " + e.line : "N/A"));
}
```

---

## Additional Improvements

1. **Added lineSpacing default** (120px) for controlling vertical offset between simultaneous lines
2. **Better trimming** using separate replace calls for ExtendScript compatibility
3. **Improved comments** explaining complex logic
4. **Better fallback logic** in syllabification (ultimate fallback returns whole text)
5. **Enhanced success message** showing number of chunks processed
6. **Cleanup** of temporary tracking arrays
7. **Consistent error handling** with try/catch blocks

---

## Testing Recommendations

1. Test with transcript containing:
   - Special characters: quotes, apostrophes, backslashes
   - Multi-line wrapped text
   - Simultaneous overlapping chunks
   - Very short chunks (< 0.02s duration)
   - Empty or malformed entries

2. Test with different:
   - AE versions (check drop shadow/glow compatibility)
   - Font names (including missing fonts)
   - Composition sizes (portrait/landscape)
   - Very long text chunks

3. Edge cases:
   - Empty transcript file
   - Malformed JSON
   - Missing timestamp fields
   - Negative or zero durations
   - Text with only spaces/punctuation

---

## Migration Guide

To use the fixed version:

1. **Backup your original script**
2. **Replace with:** `cantiere_lyrics_video_karaoke_FIXED.jsx`
3. **Test with a sample transcript** before production use
4. **No changes needed to transcript format** - both JSON and YAML-like formats still supported

The fixed script is **backward compatible** with your existing transcript files.
