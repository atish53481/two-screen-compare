"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultStorePath = void 0;
exports.openStore = openStore;
// Persistent SQLite store (node:sqlite, Node >= 22.13): profiles, run history, findings, expectations, secrets.
// The Store interface is the seam for a future Postgres adapter.
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const node_sqlite_1 = require("node:sqlite");
const secrets_1 = require("./secrets");
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, profile_id TEXT, project_name TEXT, dev_url TEXT, prod_url TEXT, started_at TEXT, ended_at TEXT, summary_json TEXT);
CREATE TABLE IF NOT EXISTS findings(id TEXT PRIMARY KEY, run_id TEXT, fingerprint TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
CREATE TABLE IF NOT EXISTS logs(run_id TEXT, seq INTEGER, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_logs_run ON logs(run_id, seq);
CREATE TABLE IF NOT EXISTS expectations(profile_id TEXT, fingerprint TEXT, note TEXT, created_at TEXT, PRIMARY KEY(profile_id, fingerprint));
CREATE TABLE IF NOT EXISTS secrets(ref TEXT PRIMARY KEY, blob TEXT NOT NULL);
INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '1');
`;
const stores = () => {
    const g = globalThis;
    return (g.__qaVisionStores ||= new Map());
};
const defaultStorePath = () => path_1.default.join((0, secrets_1.getDataDir)(), 'qa-vision.db');
exports.defaultStorePath = defaultStorePath;
function openStore(file = (0, exports.defaultStorePath)()) {
    const key = path_1.default.resolve(file);
    const cached = stores().get(key);
    if (cached)
        return cached;
    fs_1.default.mkdirSync(path_1.default.dirname(key), { recursive: true });
    const db = new node_sqlite_1.DatabaseSync(key);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec(SCHEMA);
    const tx = (fn) => {
        db.exec('BEGIN');
        try {
            fn();
            db.exec('COMMIT');
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    };
    const store = {
        listProfiles: () => db.prepare('SELECT json FROM profiles ORDER BY rowid').all().map((r) => JSON.parse(r.json)),
        getProfile: (id) => {
            const r = db.prepare('SELECT json FROM profiles WHERE id=?').get(id);
            return r ? JSON.parse(r.json) : undefined;
        },
        saveProfile: (p) => {
            db.prepare('INSERT INTO profiles(id, json, updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at').run(p.id, JSON.stringify(p), p.updatedAt || new Date().toISOString());
        },
        deleteProfile: (id) => Number(db.prepare('DELETE FROM profiles WHERE id=?').run(id).changes) > 0,
        saveRun: (snap) => {
            const mismatches = snap.mismatches || [];
            const logs = snap.logs || [];
            const bySeverity = {};
            const byType = {};
            let expected = 0;
            for (const m of mismatches) {
                bySeverity[m.severity] = (bySeverity[m.severity] || 0) + 1;
                byType[m.type] = (byType[m.type] || 0) + 1;
                if (m.classification === 'EXPECTED_DIFFERENCE')
                    expected++;
            }
            const counts = { total: mismatches.length, bySeverity, byType, expected };
            tx(() => {
                db.prepare('DELETE FROM findings WHERE run_id=?').run(snap.id);
                db.prepare('DELETE FROM logs WHERE run_id=?').run(snap.id);
                db.prepare('INSERT OR REPLACE INTO runs(id, profile_id, project_name, dev_url, prod_url, started_at, ended_at, summary_json) VALUES(?,?,?,?,?,?,?,?)').run(snap.id, snap.profileId ?? null, snap.projectName, snap.devUrl, snap.prodUrl, snap.startedAt, snap.endedAt ?? null, JSON.stringify({ counts }));
                const insF = db.prepare('INSERT OR REPLACE INTO findings(id, run_id, fingerprint, json) VALUES(?,?,?,?)');
                mismatches.forEach((m, i) => insF.run(`${snap.id}:${i}:${m.id}`, snap.id, m.fingerprint ?? null, JSON.stringify(m)));
                const insL = db.prepare('INSERT INTO logs(run_id, seq, json) VALUES(?,?,?)');
                logs.forEach((l, i) => insL.run(snap.id, i, JSON.stringify(l)));
            });
        },
        listRuns: (limit = 50) => db.prepare('SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?').all(limit).map((r) => ({
            id: r.id,
            profileId: r.profile_id,
            projectName: r.project_name,
            devUrl: r.dev_url,
            prodUrl: r.prod_url,
            startedAt: r.started_at,
            endedAt: r.ended_at,
            counts: JSON.parse(r.summary_json).counts,
        })),
        getRun: (id) => {
            const r = db.prepare('SELECT * FROM runs WHERE id=?').get(id);
            if (!r)
                return null;
            const logs = db.prepare('SELECT json FROM logs WHERE run_id=? ORDER BY seq').all(id).map((x) => JSON.parse(x.json));
            const mismatches = db.prepare('SELECT json FROM findings WHERE run_id=? ORDER BY rowid').all(id).map((x) => JSON.parse(x.json));
            return {
                id: r.id,
                ...(r.profile_id ? { profileId: r.profile_id } : {}),
                projectName: r.project_name,
                devUrl: r.dev_url,
                prodUrl: r.prod_url,
                startedAt: r.started_at,
                ...(r.ended_at ? { endedAt: r.ended_at } : {}),
                logs,
                mismatches,
            };
        },
        listExpectations: (profileId) => db.prepare('SELECT fingerprint, note, created_at FROM expectations WHERE profile_id=? ORDER BY created_at, rowid').all(profileId)
            .map((r) => ({ fingerprint: r.fingerprint, note: r.note, createdAt: r.created_at })),
        addExpectation: (profileId, fingerprint, note) => {
            db.prepare('INSERT OR REPLACE INTO expectations(profile_id, fingerprint, note, created_at) VALUES(?,?,?,?)')
                .run(profileId, fingerprint, note, new Date().toISOString());
        },
        removeExpectation: (profileId, fingerprint) => {
            db.prepare('DELETE FROM expectations WHERE profile_id=? AND fingerprint=?').run(profileId, fingerprint);
        },
        putSecret: (ref, blob) => {
            db.prepare('INSERT OR REPLACE INTO secrets(ref, blob) VALUES(?,?)').run(ref, blob);
        },
        getSecret: (ref) => {
            const r = db.prepare('SELECT blob FROM secrets WHERE ref=?').get(ref);
            return r ? r.blob : null;
        },
        deleteSecret: (ref) => {
            db.prepare('DELETE FROM secrets WHERE ref=?').run(ref);
        },
    };
    // Register before migrating: migration re-enters openStore through the secret helpers.
    stores().set(key, store);
    try {
        migrateLegacyFiles(store, path_1.default.dirname(key));
    }
    catch (e) {
        console.error('QA Vision store: legacy migration failed:', e.message);
    }
    return store;
}
function readJson(file) {
    try {
        return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        return null;
    }
}
function migrateLegacyFiles(store, dir) {
    // Task 11 blobs first (already encrypted), then profiles (plaintext passwords get encrypted).
    // Each entry is imported on its own: one malformed entry is logged and skipped, never fatal.
    const secretsFile = path_1.default.join(dir, 'secrets.json');
    if (fs_1.default.existsSync(secretsFile)) {
        const map = readJson(secretsFile);
        if (map && typeof map === 'object' && !Array.isArray(map)) {
            for (const [ref, blob] of Object.entries(map)) {
                try {
                    if (typeof blob === 'string')
                        store.putSecret(ref, blob);
                }
                catch (e) {
                    console.error(`Secret "${ref}": skipped during migration (${e.message})`);
                }
            }
        }
        else {
            console.error('secrets.json is not a valid secret map; nothing imported');
        }
        fs_1.default.renameSync(secretsFile, `${secretsFile}.migrated`);
    }
    const profilesFile = path_1.default.join(dir, 'profiles.json');
    if (fs_1.default.existsSync(profilesFile)) {
        const list = readJson(profilesFile);
        if (Array.isArray(list)) {
            for (const p of list) {
                try {
                    if (!p || typeof p.id !== 'string')
                        continue;
                    const hasPlain = [p.credentialsA, p.credentialsB].some((c) => c && typeof c === 'object' && 'password' in c);
                    let profile = p;
                    if (hasPlain) {
                        const r = (0, secrets_1.safeStoreProfileSecrets)(p, dir);
                        if (r.error)
                            console.error(`Profile "${p.id}": could not encrypt legacy password (${r.error}); it was removed`);
                        profile = r.profile;
                    }
                    store.saveProfile(profile);
                }
                catch (e) {
                    console.error(`Profile "${p?.id}": skipped during migration (${e.message})`);
                }
            }
        }
        else {
            console.error('profiles.json is not a profile list; nothing imported');
        }
        fs_1.default.renameSync(profilesFile, `${profilesFile}.migrated`);
    }
}
