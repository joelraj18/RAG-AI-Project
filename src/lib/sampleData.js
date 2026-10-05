// Deterministic sample CSV so first-time visitors can explore without their own file.

const mulberry32 = (seed) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const MODELS = [
    { name: 'Pro Max', base: 1199 },
    { name: 'Pro', base: 999 },
    { name: 'Standard', base: 799 },
    { name: 'Plus', base: 899 },
    { name: 'e', base: 599 },
];
const COLORS = ['Green', 'Blue', 'Pink', 'White', 'Black'];
const REGIONS = ['North', 'South', 'East', 'West'];
const CHANNELS = ['Online', 'Store', 'Carrier'];

export const SAMPLE_NAME = 'Phone sales sample.csv';

export function createSampleCsv(rows = 20000) {
    const rand = mulberry32(42);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const start = Date.UTC(2024, 0, 1);
    const lines = ['OrderID,OrderDate,Model,Color,Region,Channel,StorageGB,Price,Discount,CustomerAge,Satisfaction'];

    for (let i = 0; i < rows; i++) {
        const model = MODELS[Math.min(Math.floor(rand() ** 1.4 * MODELS.length), MODELS.length - 1)];
        const storage = pick([128, 256, 512, 1024]);
        const channel = pick(CHANNELS);
        // Sales ramp up towards the end of the year, with a September launch spike.
        const dayOffset = Math.floor(Math.sqrt(rand()) * 365);
        const date = new Date(start + (rand() < 0.08 ? 244 + Math.floor(rand() * 14) : dayOffset) * 864e5);
        const discount = channel === 'Carrier' ? Math.round(rand() * 150) : Math.round(rand() * 40);
        const price = Math.round(model.base + (storage - 128) * 0.9 - discount);
        const age = Math.round(18 + rand() * 45);
        const satisfaction = rand() < 0.04 ? '' : (Math.round((3 + rand() * 2 - (discount > 100 ? 0.4 : 0)) * 10) / 10).toFixed(1);
        lines.push([10000 + i, date.toISOString().slice(0, 10), model.name, pick(COLORS), pick(REGIONS), channel, storage, price, discount, age, satisfaction].join(','));
    }
    return `${lines.join('\n')}\n`;
}

export function createSampleFile(rows) {
    const csv = createSampleCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    // File isn't constructible in every test environment; a named Blob works the same for analysis.
    if (typeof File === 'function') {
        try {
            return new File([blob], SAMPLE_NAME, { type: 'text/csv' });
        } catch {
            // fall through
        }
    }
    blob.name = SAMPLE_NAME;
    return blob;
}
