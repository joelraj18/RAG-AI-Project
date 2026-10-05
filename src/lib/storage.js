// Thin wrapper around localStorage. All data stays in this browser.

const USERS_KEY = 'datamind_users';
const SESSION_KEY = 'datamind_current_user';
const datasetsKey = (email) => `datamind_${email}_data`;

const read = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};

/** Returns true when written, false when the browser refused (usually quota exceeded). */
const write = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
};

const sameEmail = (a = '', b = '') => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Only the public profile is kept in the session, never the password. */
const publicProfile = ({ id, name, email }) => ({ id, name, email });

export function getSessionUser() {
    const user = read(SESSION_KEY, null);
    return user?.email ? publicProfile(user) : null;
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

export function register({ name, email, password }) {
    const users = read(USERS_KEY, []);
    if (users.some((u) => sameEmail(u.email, email))) {
        throw new Error('That email is already registered. Sign in instead.');
    }
    const user = { id: Date.now(), name, email, password };
    write(USERS_KEY, [...users, user]);
    write(SESSION_KEY, publicProfile(user));
    return publicProfile(user);
}

export function signIn({ email, password }) {
    const user = read(USERS_KEY, []).find((u) => sameEmail(u.email, email) && u.password === password);
    if (!user) throw new Error('Incorrect email or password.');
    write(SESSION_KEY, publicProfile(user));
    return publicProfile(user);
}

/* ---------- Datasets ----------
 * A dataset record holds its analysis (a few hundred KB, whatever the file size) and, when the
 * browser allows, the original file so it can be downloaded again. Records live in IndexedDB;
 * localStorage (~5 MB) is only a fallback where IndexedDB is unavailable.
 */

/** Files above this are not copied into browser storage; their analysis still is. */
export const MAX_STORED_FILE_BYTES = 512 * 1024 * 1024;

const DB_NAME = 'datamind';
const STORE = 'datasets';
const recordKey = (email, id) => `${email}:${id}`;

let dbPromise = null;
const openDb = () => {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (!dbPromise) {
        dbPromise = new Promise((resolve) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
                store.createIndex('owner', 'owner');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null); // e.g. disabled in private mode
        });
    }
    return dbPromise;
};

const run = (db, mode, fn) =>
    new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

const toRecord = (email, dataset) => ({ ...dataset, key: recordKey(email, dataset.id), owner: email });
const fromRecord = ({ key, owner, ...dataset }) => dataset;

export async function loadDatasets(email) {
    const db = await openDb();
    const legacy = read(datasetsKey(email), []);
    if (!db) return legacy;

    // One-time migration of datasets saved by earlier versions in localStorage.
    if (legacy.length) {
        try {
            await run(db, 'readwrite', (store) => legacy.forEach((d) => store.put(toRecord(email, d))));
            localStorage.removeItem(datasetsKey(email));
        } catch {
            return legacy;
        }
    }

    try {
        const records = await run(db, 'readonly', (store) => store.index('owner').getAll(email));
        return records.map(fromRecord).sort((a, b) => a.id - b.id);
    } catch {
        return [];
    }
}

/**
 * Persists one dataset. Resolves 'full' (analysis + file), 'analysis' (file too large or refused)
 * or false (nothing could be stored).
 */
export async function saveDataset(email, dataset) {
    const db = await openDb();
    const { file, ...summary } = dataset;
    if (!db) return write(datasetsKey(email), [...read(datasetsKey(email), []), summary]) ? 'analysis' : false;
    const put = (record) => run(db, 'readwrite', (store) => store.put(toRecord(email, record)));
    if (file && file.size <= MAX_STORED_FILE_BYTES) {
        try {
            await put({ ...summary, file });
            return 'full';
        } catch {
            // Quota exceeded: fall back to the analysis alone.
        }
    }
    try {
        await put(summary);
        return 'analysis';
    } catch {
        return false;
    }
}

export async function deleteDataset(email, id) {
    const db = await openDb();
    if (!db) {
        write(datasetsKey(email), read(datasetsKey(email), []).filter((d) => d.id !== id));
        return;
    }
    try {
        await run(db, 'readwrite', (store) => store.delete(recordKey(email, id)));
    } catch {
        // Nothing to clean up if the record was never stored.
    }
}
