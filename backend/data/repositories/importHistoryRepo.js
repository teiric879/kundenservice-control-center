// Repository für das Upload-/Import-Protokoll. Liegt zentral in der produkte-DB
// (alle Import-Typen loggen hierhin), damit der Admin eine einheitliche Historie zeigt.

const { getDb } = require('../driver');
const db = () => getDb('produkte');

module.exports = {
  // Einen Import protokollieren. detail wird als JSON serialisiert abgelegt.
  async log({ kind, source_file, added = 0, skipped = 0, detail = null }) {
    const r = await db().run(
      'INSERT INTO import_history (ts, kind, source_file, added, skipped, detail) VALUES (?,?,?,?,?,?)',
      [new Date().toISOString(), kind, source_file ?? null, added, skipped,
       detail == null ? null : JSON.stringify(detail)],
    );
    return r.lastInsertRowid;
  },

  // Jüngste Einträge zuerst. detail wird zurück zu Objekt geparst.
  async list(limit = 50) {
    const rows = await db().all(
      'SELECT * FROM import_history ORDER BY ts DESC, id DESC LIMIT ?',
      [Math.min(Math.max(Number(limit) || 50, 1), 200)],
    );
    return rows.map((r) => ({
      ...r,
      detail: r.detail ? safeParse(r.detail) : null,
    }));
  },
};

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
