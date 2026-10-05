// Reads a byte range of a File/Blob. Works in windows, workers and jsdom (which lacks Blob#arrayBuffer).

export function readSlice(blob, start, end) {
    const part = blob.slice(start, end);
    if (typeof part.arrayBuffer === 'function') return part.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(part);
    });
}
