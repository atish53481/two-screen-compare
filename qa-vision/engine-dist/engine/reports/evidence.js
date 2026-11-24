"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBED_BUDGET_BYTES = void 0;
exports.evidenceRoot = evidenceRoot;
exports.evidenceDirFor = evidenceDirFor;
exports.safeEvidencePath = safeEvidencePath;
exports.loadEvidenceImages = loadEvidenceImages;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Total base64 budget for images embedded in one HTML report. */
exports.EMBED_BUDGET_BYTES = 25 * 1024 * 1024;
function evidenceRoot(cwd = process.cwd()) {
    return path_1.default.resolve(cwd, 'reports', 'evidence');
}
/** Evidence directory of a session; null when the id could escape the evidence root. */
function evidenceDirFor(id, cwd = process.cwd()) {
    if (!id || /[\\/:]/.test(id) || id === '.' || id === '..')
        return null;
    const root = evidenceRoot(cwd);
    const dir = path_1.default.resolve(root, id);
    return path_1.default.dirname(dir) === root ? dir : null;
}
/**
 * Resolves a screenshot reference to a real file directly inside `dir`. Only the base name is honoured, and the
 * real (symlink-resolved) location must still be inside the real evidence dir. Otherwise, or if missing: undefined.
 */
function safeEvidencePath(dir, p) {
    if (!dir || typeof p !== 'string' || !p)
        return undefined;
    const name = p.split(/[\\/]/).pop();
    if (!name || name === '.' || name === '..' || /:/.test(name))
        return undefined;
    try {
        const full = path_1.default.resolve(dir, name);
        if (path_1.default.dirname(full) !== path_1.default.resolve(dir) || !fs_1.default.existsSync(full))
            return undefined;
        const realDir = fs_1.default.realpathSync(dir);
        const realFile = fs_1.default.realpathSync(full);
        return path_1.default.dirname(realFile) === realDir && fs_1.default.statSync(realFile).isFile() ? full : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Reads the model's screenshots from `evidenceDir` only, downscaled to <= 1200 px wide and re-encoded as JPEG q80
 * (flattened on white). Returns file name -> base64 JPEG. Without sharp nothing is embedded (never full-size originals).
 * Stops adding images once the total budget is reached; missing/unreadable images never fail the report.
 */
async function loadEvidenceImages(evidenceDir, model, budgetBytes = exports.EMBED_BUDGET_BYTES) {
    const out = new Map();
    let sharp;
    try {
        sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    }
    catch {
        return out;
    }
    const names = new Set();
    for (const f of model.findings)
        for (const n of [f.devScreenshotPath, f.prodScreenshotPath, f.diffScreenshotPath])
            if (n)
                names.add(n);
    let used = 0;
    for (const name of names) {
        const full = safeEvidencePath(evidenceDir, name);
        if (!full)
            continue;
        try {
            const bytes = await sharp(fs_1.default.readFileSync(full))
                .resize({ width: 1200, withoutEnlargement: true })
                .flatten({ background: '#ffffff' })
                .jpeg({ quality: 80 })
                .toBuffer();
            const b64 = bytes.toString('base64');
            if (used + b64.length > budgetBytes)
                continue;
            used += b64.length;
            out.set(name, b64);
        }
        catch {
            /* skip */
        }
    }
    return out;
}
