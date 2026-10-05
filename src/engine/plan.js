// Reads the head of a file, infers its structure and decides how the full scan should run.

import { createRowBuffers, detectDelimiter, fieldText, isBlankRow, isNAToken, normaliseHeader, parseDay, parseNumber, tokenize } from './csv';
import { readSlice } from './io';

const SNIFF_BYTES = 1 << 20; // 1 MB
const SAMPLE_ROWS = 5000;

/** Keep every value in memory (→ exact quantiles) while rows × numeric columns stays below this. */
export const EXACT_VALUE_BUDGET = 24_000_000;
export const EXACT_MAX_ROWS = 2_000_000;

export const MAX_GROUPS = 14; // categories per column that bivariate analysis tracks
const MAX_GROUP_CATS = 6;
const MAX_GROUP_NUMS = 24;
const MAX_CORR_COLS = 40;
const MAX_TIMELINE_DATES = 3;
const MAX_TIMELINE_NUMS = 12;
const PARALLEL_MIN_BYTES = 8 << 20; // smaller files aren't worth the worker start-up
export const RESERVOIR_SIZE = 5000;
export const PREVIEW_ROWS = 20;

const ID_NAME = /(^id$|_id$|^id_|\bid\b|uuid|guid|^key$|_key$|^index$|^unnamed: 0$)/i;
const CAMEL_ID = /[a-z]I[dD]$/; // OrderID, customerId — but not "Paid" or "valid"

/** Scans the first megabyte: delimiter, header and a typed sample of rows. */
export async function sniff(file) {
    let bytes = Math.min(file.size, SNIFF_BYTES);
    for (;;) {
        const buf = new Uint8Array(await readSlice(file, 0, bytes));
        const result = sniffBuffer(buf, bytes >= file.size);
        // Very wide rows: keep reading until at least a couple of data rows are complete.
        if (result.sampleRows.length >= 2 || bytes >= file.size) return result;
        bytes = Math.min(file.size, bytes * 4);
    }
}

export function sniffBuffer(buf, isWholeFile) {
    let start = 0;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3; // UTF-8 BOM
    const delimiter = detectDelimiter(buf.subarray(start), Math.min(buf.length - start, 65536));
    const rb = createRowBuffers();

    let header = null;
    let dataStart = 0;
    const sampleRows = [];
    let rowsSeen = 0;
    let quotedNewline = false;

    const consumed = tokenize(buf, start, buf.length, delimiter, isWholeFile, rb, (n, rowStart) => {
        if (isBlankRow(n, rb)) return true;
        const fields = new Array(n);
        for (let k = 0; k < n; k++) {
            fields[k] = fieldText(buf, rb, k);
            if (rb.flags[k] & 1) {
                for (let i = rb.starts[k]; i < rb.ends[k]; i++) {
                    if (buf[i] === 10 || buf[i] === 13) quotedNewline = true;
                }
            }
        }
        if (!header) {
            header = fields;
            return true;
        }
        if (!dataStart) dataStart = rowStart;
        rowsSeen++;
        if (sampleRows.length < SAMPLE_ROWS) {
            sampleRows.push({ fields, kinds: rawKinds(buf, rb, n) });
        }
        return true;
    });

    if (!header) throw new Error('That file is empty.');
    if (!dataStart) dataStart = consumed;
    const avgRowBytes = rowsSeen ? Math.max(1, (consumed - dataStart) / rowsSeen) : 64;

    return {
        delimiter,
        header: normaliseHeader(header),
        dataStart,
        sampleRows,
        avgRowBytes,
        quotedNewline,
    };
}

// For each field: 0 missing, 1 number, 2 date, 3 text.
function rawKinds(buf, rb, n) {
    const kinds = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
        const s = rb.starts[k];
        const e = rb.ends[k];
        if (isNAToken(buf, s, e)) kinds[k] = 0;
        else if (!Number.isNaN(parseNumber(buf, s, e))) kinds[k] = 1;
        else if (!Number.isNaN(parseDay(buf, s, e))) kinds[k] = 2;
        else kinds[k] = 3;
    }
    return kinds;
}

const TYPE_THRESHOLD = 0.9;

/** Decides column types, tracked combinations, numeric shifts and how to split the work. */
export function buildPlan(sniffed, fileSize, { cores = 4, forceMode } = {}) {
    const { header, sampleRows } = sniffed;
    const kinds = header.map((_, k) => {
        let present = 0;
        let numbers = 0;
        let dates = 0;
        for (const row of sampleRows) {
            const kind = row.kinds[k];
            if (kind === undefined || kind === 0) continue;
            present++;
            if (kind === 1) numbers++;
            else if (kind === 2) dates++;
        }
        if (present === 0) return 'categorical';
        if (numbers >= present * TYPE_THRESHOLD) return 'numeric';
        if (dates >= present * TYPE_THRESHOLD) return 'date';
        return 'categorical';
    });

    const numeric = [];
    const categorical = [];
    const dates = [];
    kinds.forEach((kind, k) => (kind === 'numeric' ? numeric : kind === 'date' ? dates : categorical).push(k));

    // Sample statistics drive the shift (numerical stability) and ID / grouping heuristics.
    const shifts = new Float64Array(numeric.length);
    const idCols = [];
    numeric.forEach((col, j) => {
        const values = [];
        for (const row of sampleRows) {
            const v = Number(row.fields[col]);
            if (row.kinds[col] === 1 && Number.isFinite(v)) values.push(v);
        }
        shifts[j] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        if (looksLikeId(header[col], values)) idCols.push(col);
    });
    const sampleUnique = categorical.map((col) => new Set(sampleRows.map((r) => r.fields[col])).size);

    const groupCats = categorical
        .map((col, c) => ({ c, unique: sampleUnique[c] }))
        .filter((x) => x.unique > 1 && x.unique <= MAX_GROUPS)
        .slice(0, MAX_GROUP_CATS)
        .map((x) => x.c);

    const analysable = numeric.map((col, j) => j).filter((j) => !idCols.includes(numeric[j]));
    const corrCols = analysable.slice(0, MAX_CORR_COLS);
    const groupNums = analysable.slice(0, MAX_GROUP_NUMS);
    const timelineDates = dates.map((_, d) => d).slice(0, MAX_TIMELINE_DATES);
    const timelineNums = analysable.slice(0, MAX_TIMELINE_NUMS);

    const dataBytes = Math.max(0, fileSize - sniffed.dataStart);
    const estimatedRows = Math.round(dataBytes / sniffed.avgRowBytes);
    const exact =
        forceMode === 'exact' ||
        (forceMode !== 'stream' && estimatedRows <= EXACT_MAX_ROWS && estimatedRows * Math.max(1, numeric.length) <= EXACT_VALUE_BUDGET);

    // Parallel byte ranges are only safe when no quoted field spans lines.
    const parallel = !sniffed.quotedNewline && dataBytes >= PARALLEL_MIN_BYTES;
    const workers = parallel ? Math.max(1, Math.min(cores, 8, Math.ceil(dataBytes / PARALLEL_MIN_BYTES))) : 1;

    return {
        delimiter: sniffed.delimiter,
        columns: header,
        kinds,
        numeric,
        categorical,
        dates,
        shifts,
        idCols,
        corrCols,
        groupCats,
        groupNums,
        timelineDates,
        timelineNums,
        exact,
        // Safety valve: a worker switches to streaming if it sees far more rows than estimated.
        bufferCap: Math.ceil((Math.max(estimatedRows, 1000) * 1.5) / workers) + 10_000,
        distinctCap: 1024,
        categoryCap: 20_000,
        maxGroups: MAX_GROUPS,
        reservoirSize: RESERVOIR_SIZE,
        previewRows: PREVIEW_ROWS,
        dataStart: sniffed.dataStart,
        fileSize,
        estimatedRows,
        workers,
    };
}

function looksLikeId(name, values) {
    if (values.length < 10) return false;
    if (!values.every(Number.isInteger)) return false;
    if (new Set(values).size !== values.length) return false;
    if (ID_NAME.test(name) || CAMEL_ID.test(name)) return true;
    // A strictly increasing counter (1, 2, 3 …) is an ID whatever it's called.
    for (let i = 1; i < values.length; i++) if (values[i] - values[i - 1] !== 1) return false;
    return true;
}

/** Equal byte ranges over the data section; each worker owns the rows that start inside its range. */
export function splitRanges(plan) {
    const { dataStart, fileSize, workers } = plan;
    const size = Math.ceil((fileSize - dataStart) / workers);
    return Array.from({ length: workers }, (_, i) => ({
        index: i,
        start: dataStart + i * size,
        end: Math.min(fileSize, dataStart + (i + 1) * size),
    })).filter((r) => r.start < r.end || r.index === 0);
}
