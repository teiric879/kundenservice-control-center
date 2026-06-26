const { getDb } = require('../driver');
const db = () => getDb('produkte');

// Metadaten-Spalten (ohne das große file_data) für Listen.
const META_COLS = 'id, name, kategorie, beschreibung, source_type, source_value, active, sort_order, updated';

module.exports = {
  // Liste OHNE file_data (Base64 wäre zu groß für die Übersicht).
  // onlyActive=true filtert für die öffentliche Formularseite.
  listAll({ onlyActive = false } = {}) {
    const where = onlyActive ? 'WHERE active=1' : '';
    return db().all(
      `SELECT ${META_COLS} FROM standalone_formulare ${where} ORDER BY sort_order, id`
    );
  },

  // Vollständiger Datensatz inkl. file_data (für den /file-Endpoint).
  getById(id) {
    return db().get('SELECT * FROM standalone_formulare WHERE id=?', [id]);
  },

  async insert({ name, kategorie, beschreibung, source_type, source_value, file_data, active = 1, sort_order = 0, updated }) {
    const r = await db().run(
      `INSERT INTO standalone_formulare
         (name, kategorie, beschreibung, source_type, source_value, file_data, active, sort_order, updated)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, kategorie, beschreibung, source_type, source_value, file_data ?? null, active ? 1 : 0, sort_order, updated]
    );
    return r.lastInsertRowid;
  },

  // file_data nur überschreiben, wenn neue Bytes mitkommen (sonst bestehende behalten).
  update(id, { name, kategorie, beschreibung, source_type, source_value, file_data, active, sort_order, updated }) {
    if (file_data !== undefined && file_data !== null) {
      return db().run(
        `UPDATE standalone_formulare
           SET name=?, kategorie=?, beschreibung=?, source_type=?, source_value=?, file_data=?, active=?, sort_order=?, updated=?
         WHERE id=?`,
        [name, kategorie, beschreibung, source_type, source_value, file_data, active ? 1 : 0, sort_order ?? 0, updated, id]
      );
    }
    return db().run(
      `UPDATE standalone_formulare
         SET name=?, kategorie=?, beschreibung=?, source_type=?, source_value=?, active=?, sort_order=?, updated=?
       WHERE id=?`,
      [name, kategorie, beschreibung, source_type, source_value, active ? 1 : 0, sort_order ?? 0, updated, id]
    );
  },

  deleteById(id) {
    return db().run('DELETE FROM standalone_formulare WHERE id=?', [id]);
  },
};
