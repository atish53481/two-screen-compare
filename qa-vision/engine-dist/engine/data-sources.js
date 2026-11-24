"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runApiCheck = runApiCheck;
exports.assertReadOnlySql = assertReadOnlySql;
exports.runDbCheck = runDbCheck;
const data_rules_1 = require("./data-rules");
const runtime_diff_1 = require("./runtime-diff");
const EXACT = { target: '*', mode: 'exact' };
function getPath(obj, path) {
    let cur = obj;
    for (const k of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k))
            return { found: false, value: '' };
        cur = cur[k];
    }
    return { found: true, value: cur !== null && typeof cur === 'object' ? JSON.stringify(cur) : String(cur) };
}
async function fetchJson(ctx, url) {
    // GET only: this is the sole method ever touched on a context.
    if (typeof ctx?.get !== 'function')
        return { error: 'context has no get()' };
    try {
        const res = await ctx.get(url);
        if (!res.ok())
            return { error: `HTTP ${res.status()}` };
        return { json: await res.json() };
    }
    catch (e) {
        return { error: (0, runtime_diff_1.redactSecrets)(e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
}
async function runApiCheck(check, devCtx, prodCtx, devBase, prodBase) {
    const join = (b, p) => b.replace(/\/+$/, '') + (p.startsWith('/') ? p : '/' + p);
    const [dev, prod] = await Promise.all([fetchJson(devCtx, join(devBase, check.path)), fetchJson(prodCtx, join(prodBase, check.path))]);
    const out = [];
    if (dev.error || prod.error) {
        out.push({
            type: 'Data', component: `api:${check.name}`, devValue: dev.error ?? 'ok', prodValue: prod.error ?? 'ok', severity: 'high',
            description: `API check "${check.name}" (GET ${check.path}) failed: DEV ${dev.error ?? 'ok'}, PROD ${prod.error ?? 'ok'}`,
        });
        return out;
    }
    const rule = check.rule ?? EXACT;
    for (const field of check.fields) {
        const d = getPath(dev.json, field);
        const p = getPath(prod.json, field);
        const component = `api:${check.name}.${field}`;
        if (!d.found || !p.found) {
            out.push({
                type: 'Data', component, property: field, devValue: d.found ? d.value : '(missing)', prodValue: p.found ? p.value : '(missing)', severity: 'high',
                description: `Field ${field} missing in ${!d.found && !p.found ? 'both' : !d.found ? 'DEV' : 'PROD'} response of ${check.path}`,
            });
            continue;
        }
        const r = (0, data_rules_1.compareValues)(d.value, p.value, rule);
        if (!r.match) {
            out.push({
                type: 'Data', component, property: field, devValue: d.value, prodValue: p.value, severity: 'medium',
                description: `API ${check.path} field ${field} differs (${r.detail})`, ruleApplied: check.rule ? rule.mode : null,
            });
        }
    }
    return out;
}
const FORBIDDEN = new RegExp('\\b(' + [
    'insert', 'update', 'delete', 'merge', 'alter', 'drop', 'create', 'truncate', 'grant', 'revoke', 'copy', 'call', 'do', 'vacuum', 'lock', 'set', 'into',
    // transaction control and session state
    'commit', 'rollback', 'begin', 'end', 'abort', 'savepoint', 'release', 'prepare', 'deallocate', 'listen', 'notify', 'discard', 'reset', 'load', 'security', 'checkpoint',
    // side-effecting functions
    'pg_sleep\\w*', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_reload_conf', 'pg_rotate_logfile',
    'pg_(?:try_)?advisory_\\w+', 'query_to_xml\\w*', 'lo_\\w+', 'dblink\\w*', 'set_config', 'nextval', 'setval',
].join('|') + ')\\b', 'i');
/** Removes comments (nesting block comments) and blanks string literals / quoted identifiers. Throws on dollar quoting and E-strings. */
function sanitize(sql, keepStrings = false) {
    let out = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const c = sql[i];
        const c2 = sql[i + 1];
        if (c === '-' && c2 === '-') {
            while (i < n && sql[i] !== '\n')
                i++;
            out += ' ';
        }
        else if (c === '/' && c2 === '*') {
            let depth = 1;
            i += 2;
            while (i < n && depth > 0) {
                if (sql[i] === '/' && sql[i + 1] === '*') {
                    depth++;
                    i += 2;
                }
                else if (sql[i] === '*' && sql[i + 1] === '/') {
                    depth--;
                    i += 2;
                }
                else
                    i++;
            }
            if (depth > 0)
                throw new Error('Unterminated comment in SQL');
            out += ' ';
        }
        else if (c === "'" || c === '"') {
            if (c === "'" && /(^|[^\w$])[eE]$/.test(out))
                throw new Error('E-strings are not allowed in read-only SQL');
            let j = i + 1;
            for (;;) {
                if (j >= n)
                    throw new Error('Unterminated quoted string in SQL');
                if (sql[j] === c) {
                    if (sql[j + 1] === c) {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j++;
            }
            if (/(^|[^\w$])u&$/i.test(out))
                throw new Error('U& escapes are not allowed in read-only SQL');
            if (c === '"' && /^\s*\(/.test(sql.slice(j + 1)))
                throw new Error('Quoted function names are not allowed in read-only SQL');
            out += keepStrings ? sql.slice(i, j + 1) : c + c;
            i = j + 1;
        }
        else if (c === '$' && /^\$[A-Za-z0-9_\u0080-￿]*\$/.test(sql.slice(i))) {
            throw new Error('Dollar-quoted strings are not allowed in read-only SQL');
        }
        else {
            out += c;
            i++;
        }
    }
    return out;
}
function assertReadOnlySql(sql) {
    const code = sanitize(String(sql ?? '')).trim().replace(/;\s*$/, '').trim();
    if (!/^(select|with)\b/i.test(code))
        throw new Error('Only SELECT/WITH statements are allowed');
    if (code.includes(';'))
        throw new Error('Multiple statements are not allowed');
    const bad = FORBIDDEN.exec(code);
    if (bad)
        throw new Error(`Forbidden keyword in read-only SQL: ${bad[1].toLowerCase()}`);
}
async function runQuery(connStr, sql, Client) {
    const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 8000 });
    try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
        await client.query('SET LOCAL statement_timeout = 5000');
        // Named statement forces the extended protocol, so Postgres itself refuses multiple statements.
        const res = await client.query({ name: 'qa_ro', text: sql, values: [] });
        return res.rows;
    }
    finally {
        try {
            await client.query('ROLLBACK');
        }
        catch { /* connection may be gone */ }
        try {
            await client.end();
        }
        catch { /* ignore */ }
    }
}
async function runDbCheck(check, getSecret, ClientOverride) {
    const component = `db:${check.name}`;
    const draft = (severity, description, devValue = '', prodValue = '') => ({ type: 'Data', component, devValue, prodValue, severity, description });
    try {
        assertReadOnlySql(check.sql);
    }
    catch (e) {
        return [draft('high', `DB check "${check.name}" rejected: ${e.message}`)];
    }
    let Client;
    if (ClientOverride)
        Client = ClientOverride;
    else
        try {
            // Lazy: pg is optional until the dependency is wired in.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            Client = require('pg').Client;
        }
        catch {
            return [draft('low', 'NOT_COMPARABLE: pg driver not installed')];
        }
    const devConn = getSecret(check.devConnRef);
    const prodConn = getSecret(check.prodConnRef);
    if (!devConn || !prodConn)
        return [draft('low', `NOT_COMPARABLE: connection secret missing for ${!devConn ? 'DEV' : 'PROD'}`)];
    const base = sanitize(check.sql, true).trim().replace(/;\s*$/, '').trim();
    const sql = `select * from (\n${base}\n) q limit 500`;
    const scrub = (e) => {
        let m = e instanceof Error ? e.message : String(e);
        for (const s of [devConn, prodConn])
            m = m.split(s).join('[redacted]');
        return (0, runtime_diff_1.redactSecrets)(m).slice(0, 200);
    };
    let dev;
    let prod;
    try {
        [dev, prod] = await Promise.all([runQuery(devConn, sql, Client), runQuery(prodConn, sql, Client)]);
    }
    catch (e) {
        return [draft('high', `DB check "${check.name}" failed: ${scrub(e)}`)];
    }
    const out = [];
    if (dev.length !== prod.length) {
        out.push(draft('high', `DB check "${check.name}" row count differs`, String(dev.length), String(prod.length)));
    }
    const rule = check.rule ?? EXACT;
    const str = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (let i = 0; i < Math.min(dev.length, prod.length) && out.length < 50; i++) {
        for (const col of Object.keys(dev[i])) {
            const d = str(dev[i][col]);
            const p = str(prod[i][col]);
            const r = (0, data_rules_1.compareValues)(d, p, rule);
            if (!r.match) {
                out.push({ ...draft('medium', `DB check "${check.name}" row ${i} column ${col} differs (${r.detail})`, d, p), component: `${component}.${i}.${col}`, property: col });
            }
        }
    }
    return out;
}
