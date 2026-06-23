// Repository für die Einsatzplan-Datenbank (einsatzplan). Kapselt alles SQL rund um
// ep_agents / ep_assignments / ep_notes inkl. der Upsert-Logik (Put-Methoden).

const { getDb } = require('../driver');
const db = () => getDb('einsatzplan');

// Zuweisung inkl. Agent-Stammdaten (Join), Basis für alle Assignment-Reads.
const ASGN_SELECT = `
  SELECT a.*, ag.name, ag.kuerzel, ag.color
  FROM ep_assignments a JOIN ep_agents ag ON a.agent_id = ag.id
`;

module.exports = {
  // ── Agents ─────────────────────────────────────────────────────────────────
  listAgents() {
    return db().all('SELECT * FROM ep_agents ORDER BY name');
  },
  async insertAgent({ name, kuerzel, color }) {
    const r = await db().run(
      'INSERT INTO ep_agents (name, kuerzel, color, active) VALUES (?,?,?,1)',
      [name, String(kuerzel).toUpperCase(), color || '#3BE8C4']
    );
    return r.lastInsertRowid;
  },
  async updateAgent(id, { name, kuerzel, color, active }) {
    const fields = [], vals = [];
    if (name    !== undefined) { fields.push('name=?');    vals.push(name); }
    if (kuerzel !== undefined) { fields.push('kuerzel=?'); vals.push(String(kuerzel).toUpperCase()); }
    if (color   !== undefined) { fields.push('color=?');   vals.push(color); }
    if (active  !== undefined) { fields.push('active=?');  vals.push(active ? 1 : 0); }
    if (!fields.length) return;
    vals.push(id);
    await db().run(`UPDATE ep_agents SET ${fields.join(',')} WHERE id=?`, vals);
  },
  // Berater endgültig löschen — inkl. aller Zuweisungen und Notizen (atomar).
  deleteAgent(id) {
    return db().transaction(async (tx) => {
      await tx.run('DELETE FROM ep_assignments WHERE agent_id=?', [id]);
      await tx.run('DELETE FROM ep_notes WHERE agent_id=?', [id]);
      await tx.run('DELETE FROM ep_agents WHERE id=?', [id]);
      return { ok: true };
    });
  },

  // ── Assignments ─────────────────────────────────────────────────────────────
  listAssignments({ monday, from, to } = {}) {
    if (from && to) {
      return db().all(`${ASGN_SELECT} WHERE a.date >= ? AND a.date <= ? ORDER BY a.date, a.location, a.slot, a.time_from`, [from, to]);
    }
    if (monday) {
      return db().all(`${ASGN_SELECT} WHERE a.date >= ? AND a.date <= date(?, '+4 days') ORDER BY a.date, a.location, a.slot, a.time_from`, [monday, monday]);
    }
    return db().all(`${ASGN_SELECT} ORDER BY a.date, a.location, a.slot, a.time_from`);
  },

  // Upsert/Delete einer Zuweisung über (date, location, slot, time_from). Atomar.
  putAssignment({ date, location, slot, agent_id, time_from = '08:00', time_to = '16:00' }) {
    return db().transaction(async (tx) => {
      if (!agent_id) {
        await tx.run('DELETE FROM ep_assignments WHERE date=? AND location=? AND slot=? AND time_from=?',
          [date, location, slot, time_from]);
        return { ok: true };
      }
      const ex = await tx.get('SELECT id FROM ep_assignments WHERE date=? AND location=? AND slot=? AND time_from=?',
        [date, location, slot, time_from]);
      if (ex) {
        await tx.run('UPDATE ep_assignments SET agent_id=?, time_to=? WHERE id=?', [agent_id, time_to, ex.id]);
        return { id: ex.id };
      }
      const r = await tx.run(
        'INSERT INTO ep_assignments (date, location, slot, agent_id, time_from, time_to) VALUES (?,?,?,?,?,?)',
        [date, location, slot, agent_id, time_from, time_to]
      );
      return { id: r.lastInsertRowid };
    });
  },

  // Inkrementeller Einsatzplan-Import aus dem Excel-Upload. Bestehende Zuweisungen
  // bleiben dank UNIQUE(date,location,slot,time_from) + INSERT OR IGNORE unangetastet
  // (im Tool manuell vorgenommene Änderungen werden NICHT überschrieben). Kürzel werden
  // case-insensitiv auf agent_id gemappt; unbekannte Kürzel werden gemeldet.
  // rows: [{ date, location, slot, kuerzel, time_from, time_to }]
  async bulkInsertAssignments(rows) {
    const agents = await db().all('SELECT id, kuerzel FROM ep_agents');
    const byKz = Object.fromEntries(agents.map((a) => [String(a.kuerzel).toUpperCase().trim(), a.id]));
    let added = 0, existing = 0;
    const unknown = {};
    await db().transaction(async (tx) => {
      for (const r of (rows || [])) {
        const kz = String(r.kuerzel || '').toUpperCase().trim();
        const agentId = byKz[kz];
        if (!agentId) { if (kz) unknown[kz] = (unknown[kz] || 0) + 1; continue; }
        const res = await tx.run(
          'INSERT OR IGNORE INTO ep_assignments (date, location, slot, agent_id, time_from, time_to) VALUES (?,?,?,?,?,?)',
          [r.date, r.location, r.slot, agentId, r.time_from || '08:00', r.time_to || '16:00'],
        );
        if (res.changes > 0) added++; else existing++;
      }
    });
    const unknownKuerzel = Object.entries(unknown).map(([kuerzel, count]) => ({ kuerzel, count }));
    const unknownCount = unknownKuerzel.reduce((s, u) => s + u.count, 0);
    return { added, existing, unknownCount, unknownKuerzel, skipped: existing + unknownCount };
  },

  async patchAssignment(id, time_from, time_to) {
    await db().run('UPDATE ep_assignments SET time_from=?, time_to=? WHERE id=?', [time_from, time_to, id]);
  },
  async deleteAssignment(id) {
    await db().run('DELETE FROM ep_assignments WHERE id=?', [id]);
  },

  // ── Notes ───────────────────────────────────────────────────────────────────
  listNotes({ monday, from, to } = {}) {
    if (from && to) return db().all('SELECT * FROM ep_notes WHERE date >= ? AND date <= ?', [from, to]);
    if (monday) return db().all("SELECT * FROM ep_notes WHERE date >= ? AND date <= date(?, '+4 days')", [monday, monday]);
    return db().all('SELECT * FROM ep_notes ORDER BY date');
  },

  // Upsert/Delete einer Notiz über (date, agent_id). Leerer Text = löschen. Atomar.
  putNote({ date, agent_id, text }) {
    const clean = text && text.trim();
    return db().transaction(async (tx) => {
      const ex = await tx.get('SELECT id FROM ep_notes WHERE date=? AND agent_id=?', [date, agent_id]);
      if (ex) {
        if (!clean) await tx.run('DELETE FROM ep_notes WHERE id=?', [ex.id]);
        else await tx.run('UPDATE ep_notes SET text=? WHERE id=?', [clean, ex.id]);
        return { ok: true };
      }
      if (clean) {
        const r = await tx.run('INSERT INTO ep_notes (date, agent_id, text) VALUES (?,?,?)', [date, agent_id, clean]);
        return { id: r.lastInsertRowid };
      }
      return { ok: true };
    });
  },

  // ── Stats ─────────────────────────────────────────────────────────────────
  stats({ year, month } = {}) {
    let dateCond = '', dateParam = null;
    if (year && month) { dateCond = 'AND a.date LIKE ?'; dateParam = `${year}-${String(month).padStart(2, '0')}-%`; }
    else if (year)     { dateCond = 'AND a.date LIKE ?'; dateParam = `${year}-%`; }

    const sql = `
      SELECT ag.id, ag.name, ag.kuerzel, ag.color, ag.active,
        COUNT(DISTINCT CASE WHEN a.location='kall'       THEN a.date||a.slot END) AS kall,
        COUNT(DISTINCT CASE WHEN a.location='euskirchen' THEN a.date||a.slot END) AS euskirchen,
        COUNT(DISTINCT CASE WHEN a.location='homeoffice' THEN a.date||a.slot END) AS homeoffice,
        COUNT(DISTINCT a.date||a.slot) AS total
      FROM ep_agents ag
      LEFT JOIN ep_assignments a ON ag.id = a.agent_id ${dateCond}
      GROUP BY ag.id ORDER BY ag.name
    `;
    return dateParam ? db().all(sql, [dateParam]) : db().all(sql);
  },
};
