// libSQL/Turso-Driver — kapselt @libsql/client hinter einem schlanken, async Interface.
//
// Dieses Interface ist die EINZIGE Stelle, die einen konkreten DB-Treiber kennt. Repositories
// sprechen ausschließlich mit { all, get, run, exec, transaction }. Für einen späteren Wechsel
// auf SQL Server / Azure SQL wird nur ein zweiter Driver mit derselben Signatur gebaut
// (api/data/driver/mssql.js o.Ä.) und in index.js eingehängt — Repos/Routes/UI bleiben unberührt.
//
// Param-Konvention: positionale '?'-Platzhalter + Array. (Bei einem MSSQL-Driver würde dieser
// Driver '?' intern auf '@pN' mappen; deshalb laufen alle Queries durch diese Schicht.)

// @libsql/client/http: pure-fetch variant — no native bindings, works in all serverless envs.
// Locally (file: URL) falls back to the full client installed in backend/node_modules/.
const isFileUrl = (url) => url && url.startsWith('file:');

function getCreateClient(url) {
  if (isFileUrl(url)) {
    // Lokaler Dev-Pfad (native Bindings). Variable-require → vom ncc-Bundler NICHT eingezogen,
    // damit das Vercel-Bundle frei von nativem Code bleibt (auf Vercel nie erreicht).
    const nativeMod = '@libsql/client';
    return require(nativeMod).createClient;
  }
  // Serverless/Turso: reiner fetch-Client, wird statisch ins ncc-Bundle aufgenommen.
  return require('@libsql/client/http').createClient;
}

// libSQL-Row → schlichtes Plain-Object (Spaltenname → Wert), robust über die columns-Liste.
function toObjects(result) {
  const cols = result.columns || [];
  return result.rows.map((row) => {
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = row[i];
    return o;
  });
}

// undefined ist als libSQL-Argument unzulässig → auf null normalisieren.
function normArgs(params) {
  return (params || []).map((p) => (p === undefined ? null : p));
}

function lastId(result) {
  // lastInsertRowid kommt als BigInt; JS-seitig erwartet der Code eine Number.
  const v = result.lastInsertRowid;
  return v == null ? undefined : Number(v);
}

// Baut das Repository-Interface über einem konkreten Executor (Client ODER Transaktion).
function makeApi(exec) {
  return {
    async all(sql, params = []) {
      return toObjects(await exec.execute({ sql, args: normArgs(params) }));
    },
    async get(sql, params = []) {
      const r = await exec.execute({ sql, args: normArgs(params) });
      return r.rows.length ? toObjects(r)[0] : undefined;
    },
    async run(sql, params = []) {
      const r = await exec.execute({ sql, args: normArgs(params) });
      return { lastInsertRowid: lastId(r), changes: Number(r.rowsAffected || 0) };
    },
  };
}

function makeDb(url, authToken) {
  const createClient = getCreateClient(url);
  const client = createClient({ url, authToken: authToken || undefined, intMode: 'number' });
  const base = makeApi(client);

  return {
    ...base,

    // Multi-Statement-DDL (CREATE/ALTER getrennt durch ';'). KEINE Parameter.
    async exec(sql) {
      await client.executeMultiple(sql);
    },

    // Mehrere parametrisierte Statements in EINEM Round-Trip (transaktional: commit bei
    // Erfolg, sonst Rollback). Entscheidend für große Bulk-Imports gegen Turso – statt N
    // einzelner HTTP-Requests (→ 504-Timeout auf Vercel) nur einer. statements: [{sql,args}].
    async batch(statements, mode = 'write') {
      const stmts = (statements || []).map((s) =>
        typeof s === 'string' ? { sql: s, args: [] } : { sql: s.sql, args: normArgs(s.args) });
      const results = await client.batch(stmts, mode);
      return (results || []).map((r) => ({ lastInsertRowid: lastId(r), changes: Number(r.rowsAffected || 0) }));
    },

    // Atomare Transaktion. fn bekommt dasselbe { all, get, run }-Interface, gebunden an die Tx.
    // Commit bei Erfolg, Rollback bei Fehler.
    async transaction(fn) {
      const tx = await client.transaction('write');
      try {
        const result = await fn(makeApi(tx));
        await tx.commit();
        return result;
      } catch (e) {
        try { await tx.rollback(); } catch { /* Tx evtl. schon geschlossen */ }
        throw e;
      }
    },

    // Roh-Client (z.B. für PRAGMA beim Schema-Setup). Repos sollten ihn nicht brauchen.
    _client: client,
  };
}

module.exports = { makeDb };
