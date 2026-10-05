// Byte-level CSV primitives. Everything here works on Uint8Array slices so huge files can be
// streamed without materialising row objects or intermediate strings.

const QUOTE = 34;
const LF = 10;
const CR = 13;
const SPACE = 32;

/* ---------- Tokenizer ---------- */

/** Reusable per-row field offsets. Grows automatically for wide files. */
export function createRowBuffers(initialFields = 64) {
    return {
        starts: new Int32Array(initialFields),
        ends: new Int32Array(initialFields),
        flags: new Uint8Array(initialFields), // bit 1: quoted, bit 2: contains escaped quotes ("")
    };
}

function growRowBuffers(rb) {
    const size = rb.starts.length * 2;
    const starts = new Int32Array(size);
    const ends = new Int32Array(size);
    const flags = new Uint8Array(size);
    starts.set(rb.starts);
    ends.set(rb.ends);
    flags.set(rb.flags);
    rb.starts = starts;
    rb.ends = ends;
    rb.flags = flags;
}

/**
 * Tokenises complete rows of `buf[from, to)` (RFC 4180: quoted fields, "" escapes, CRLF/LF/CR).
 * For each row it calls `onRow(fieldCount, rowStart)` with offsets left in `rb`.
 *
 * Returns the offset of the first unconsumed byte:
 *  - when `isFinal` is false, an incomplete trailing row is left for the next call;
 *  - when `onRow` returns `false`, that row counts as unconsumed and tokenising stops.
 */
export function tokenize(buf, from, to, delimiter, isFinal, rb, onRow) {
    let i = from;
    while (i < to) {
        const rowStart = i;
        let n = 0;
        for (;;) {
            if (n === rb.starts.length) growRowBuffers(rb);
            let flag = 0;
            let fieldStart;
            let fieldEnd;
            if (buf[i] === QUOTE && i < to) {
                flag = 1;
                fieldStart = ++i;
                for (;;) {
                    if (i >= to) {
                        if (!isFinal) return rowStart;
                        fieldEnd = i; // unterminated quote at EOF: take what we have
                        break;
                    }
                    if (buf[i] === QUOTE) {
                        if (i + 1 >= to && !isFinal) return rowStart; // need one byte of lookahead
                        if (buf[i + 1] === QUOTE) {
                            flag |= 2;
                            i += 2;
                            continue;
                        }
                        fieldEnd = i++;
                        break;
                    }
                    i++;
                }
                // Tolerate stray characters between the closing quote and the delimiter.
                while (i < to) {
                    const c = buf[i];
                    if (c === delimiter || c === LF || c === CR) break;
                    i++;
                }
            } else {
                fieldStart = i;
                while (i < to) {
                    const c = buf[i];
                    if (c === delimiter || c === LF || c === CR) break;
                    i++;
                }
                fieldEnd = i;
            }

            rb.starts[n] = fieldStart;
            rb.ends[n] = fieldEnd;
            rb.flags[n] = flag;
            n++;

            if (i >= to) {
                if (!isFinal) return rowStart;
                break; // last row without a trailing newline
            }
            const c = buf[i];
            if (c === delimiter) {
                i++;
                if (i >= to) {
                    if (!isFinal) return rowStart;
                    if (n === rb.starts.length) growRowBuffers(rb);
                    rb.starts[n] = i;
                    rb.ends[n] = i;
                    rb.flags[n] = 0;
                    n++;
                    break;
                }
                continue;
            }
            if (c === CR) {
                if (i + 1 < to) i += buf[i + 1] === LF ? 2 : 1;
                else if (!isFinal) return rowStart;
                else i++;
            } else {
                i++;
            }
            break;
        }
        if (onRow(n, rowStart) === false) return rowStart;
    }
    return to;
}

/** True for a row consisting of a single empty, unquoted field (a blank line). */
export const isBlankRow = (n, rb) => n === 1 && rb.flags[0] === 0 && rb.ends[0] === rb.starts[0];

/* ---------- Decoding ---------- */

const utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

function decodeUtf8Slow(buf, s, e) {
    let out = '';
    let i = s;
    while (i < e) {
        const b = buf[i++];
        let cp;
        if (b < 0x80) cp = b;
        else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (buf[i++] & 0x3f);
        else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((buf[i++] & 0x3f) << 6) | (buf[i++] & 0x3f);
        else cp = ((b & 0x07) << 18) | ((buf[i++] & 0x3f) << 12) | ((buf[i++] & 0x3f) << 6) | (buf[i++] & 0x3f);
        out += String.fromCodePoint(cp);
    }
    return out;
}

/** Decodes buf[s, e) as UTF-8, with a fast path for short ASCII fields. */
export function decodeBytes(buf, s, e) {
    const len = e - s;
    if (len === 0) return '';
    if (len <= 64) {
        let ascii = true;
        for (let i = s; i < e; i++) {
            if (buf[i] > 127) {
                ascii = false;
                break;
            }
        }
        if (ascii) return String.fromCharCode.apply(null, buf.subarray(s, e));
    }
    return utf8 ? utf8.decode(buf.subarray(s, e)) : decodeUtf8Slow(buf, s, e);
}

/** Field text with CSV escaping removed. */
export function fieldText(buf, rb, k) {
    const text = decodeBytes(buf, rb.starts[k], rb.ends[k]);
    return rb.flags[k] & 2 ? text.replace(/""/g, '"') : text;
}

/* ---------- Missing values (same default tokens as pandas.read_csv) ---------- */

export const NA_TOKENS = new Set([
    '', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN',
    '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null',
]);

// Tokens grouped by byte length, so a check is a few byte comparisons and never allocates.
const NA_BY_LENGTH = (() => {
    const out = [];
    for (const token of NA_TOKENS) {
        const bytes = Array.from(token, (ch) => ch.charCodeAt(0));
        (out[bytes.length] = out[bytes.length] || []).push(bytes);
    }
    return out;
})();

/** Whether buf[s, e) is one of the missing-value tokens. */
export function isNAToken(buf, s, e) {
    const len = e - s;
    if (len === 0) return true;
    const candidates = NA_BY_LENGTH[len];
    if (candidates === undefined) return false;
    outer: for (let t = 0; t < candidates.length; t++) {
        const token = candidates[t];
        for (let i = 0; i < len; i++) if (buf[s + i] !== token[i]) continue outer;
        return true;
    }
    return false;
}

/* ---------- Numbers ---------- */

// Exact powers of ten: an integer mantissa below 2^53 divided by one of these is correctly rounded.
const POW10 = [1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseNumberSlow(buf, s, e) {
    const text = decodeBytes(buf, s, e);
    const value = NUMBER_RE.test(text) ? Number(text) : NaN;
    return Number.isFinite(value) ? value : NaN; // "1e999" overflows: treat as not-a-number
}

/**
 * Parses a decimal number straight from bytes, matching JavaScript's (and pandas') correctly
 * rounded result. Returns NaN for anything that isn't a plain number (e.g. "1,200", "12kg").
 */
export function parseNumber(buf, s, e) {
    while (s < e && buf[s] === SPACE) s++;
    while (e > s && buf[e - 1] === SPACE) e--;
    if (s === e) return NaN;

    let i = s;
    let neg = false;
    if (buf[i] === 45) {
        neg = true;
        i++;
    } else if (buf[i] === 43) {
        i++;
    }

    let mantissa = 0;
    let significant = 0;
    let scale = 0;
    let digits = 0;

    while (i < e) {
        const d = buf[i] - 48;
        if (d < 0 || d > 9) break;
        if (mantissa !== 0 || d !== 0) {
            if (++significant > 15) return parseNumberSlow(buf, s, e);
            mantissa = mantissa * 10 + d;
        }
        digits++;
        i++;
    }
    if (i < e && buf[i] === 46) {
        i++;
        while (i < e) {
            const d = buf[i] - 48;
            if (d < 0 || d > 9) break;
            if (mantissa !== 0 || d !== 0) {
                if (++significant > 15) return parseNumberSlow(buf, s, e);
            }
            mantissa = mantissa * 10 + d;
            scale++;
            digits++;
            i++;
        }
    }
    if (digits === 0) return NaN;
    if (i < e) {
        const c = buf[i];
        return c === 101 || c === 69 ? parseNumberSlow(buf, s, e) : NaN; // exponent → slow path
    }
    const value = scale === 0 ? mantissa : scale <= 22 ? mantissa / POW10[scale] : parseNumberSlow(buf, s, e);
    return neg ? -value : value;
}

/* ---------- Dates ---------- */

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm). */
export function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

export function civilFromDays(z) {
    z += 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Parses ISO-style dates — YYYY-MM-DD or YYYY/MM/DD, optionally followed by a time — into a day
 * number. Returns NaN otherwise. Ambiguous day/month orders (03/04/2024) are deliberately not guessed.
 */
export function parseDay(buf, s, e) {
    while (s < e && buf[s] === SPACE) s++;
    if (e - s < 10) return NaN;
    const sep = buf[s + 4];
    if ((sep !== 45 && sep !== 47) || buf[s + 7] !== sep) return NaN;
    let y = 0;
    for (let i = s; i < s + 4; i++) {
        const d = buf[i] - 48;
        if (d < 0 || d > 9) return NaN;
        y = y * 10 + d;
    }
    const m1 = buf[s + 5] - 48;
    const m2 = buf[s + 6] - 48;
    const d1 = buf[s + 8] - 48;
    const d2 = buf[s + 9] - 48;
    if (m1 < 0 || m1 > 9 || m2 < 0 || m2 > 9 || d1 < 0 || d1 > 9 || d2 < 0 || d2 > 9) return NaN;
    const m = m1 * 10 + m2;
    const d = d1 * 10 + d2;
    if (m < 1 || m > 12 || d < 1 || d > DAYS_IN_MONTH[m - 1]) return NaN;
    if (s + 10 < e) {
        const next = buf[s + 10];
        if (next !== 84 && next !== SPACE) return NaN; // 'T' or ' ' before a time part
    }
    return daysFromCivil(y, m, d);
}

/* ---------- Hashing ---------- */

/** Two independent 32-bit hashes of buf[s, e); the second lands in `out[1]`. */
export function hashBytes(buf, s, e, out) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9747b28c ^ (e - s);
    for (let i = s; i < e; i++) {
        const c = buf[i];
        h1 = Math.imul(h1 ^ c, 16777619);
        h2 = Math.imul(h2 ^ c, 0x5bd1e995);
        h2 ^= h2 >>> 15;
    }
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;
    h2 ^= h2 >>> 13;
    h2 = Math.imul(h2, 0x5bd1e995);
    h2 ^= h2 >>> 15;
    out[0] = h1 >>> 0;
    out[1] = h2 >>> 0;
}

/* ---------- Sniffing ---------- */

const CANDIDATE_DELIMITERS = [44, 59, 9, 124]; // , ; \t |

/** Picks the delimiter that splits the first lines into the most consistent, widest rows. */
export function detectDelimiter(buf, end) {
    let best = 44;
    let bestScore = -1;
    for (const delim of CANDIDATE_DELIMITERS) {
        const counts = [];
        let count = 0;
        let quoted = false;
        for (let i = 0; i < end && counts.length < 50; i++) {
            const c = buf[i];
            if (c === QUOTE) quoted = !quoted;
            else if (!quoted && c === delim) count++;
            else if (!quoted && c === LF) {
                counts.push(count);
                count = 0;
            }
        }
        if (count) counts.push(count);
        if (!counts.length || counts[0] === 0) continue;
        const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
        const score = consistent * 1000 + counts[0];
        if (score > bestScore) {
            bestScore = score;
            best = delim;
        }
    }
    return best;
}

/** pandas-style header clean-up: blanks become "Unnamed: i", duplicates get ".1", ".2"… */
export function normaliseHeader(names) {
    const seen = new Map();
    return names.map((raw, i) => {
        const base = raw.trim() === '' ? `Unnamed: ${i}` : raw;
        let name = base;
        let k = seen.get(base) || 0;
        while (seen.has(name)) name = `${base}.${++k}`;
        seen.set(base, k);
        seen.set(name, seen.get(name) || 0);
        return name;
    });
}
