const { getDb } = require('../driver');
const db = () => getDb('produkte');

// Metadaten-Spalten (ohne das große file_data) für Listen.
const META_COLS = 'id, sparte, produkt_key, name, source_type, source_value, sort_order';

module.exports = {
  // Liste OHNE file_data (Base64 wäre zu groß für die Übersicht).
  listAll() {
    return db().all(
      `SELECT ${META_COLS} FROM vertragsformulare ORDER BY sparte, produkt_key, sort_order, id`
    );
  },

  // Vollständiger Datensatz inkl. file_data (für den /file-Endpoint).
  getById(id) {
    return db().get('SELECT * FROM vertragsformulare WHERE id=?', [id]);
  },

  async insert({ sparte, produkt_key, name, source_type, source_value, file_data, sort_order = 0 }) {
    const r = await db().run(
      'INSERT INTO vertragsformulare (sparte, produkt_key, name, source_type, source_value, file_data, sort_order) VALUES (?,?,?,?,?,?,?)',
      [sparte, produkt_key, name, source_type, source_value, file_data ?? null, sort_order]
    );
    return r.lastInsertRowid;
  },

  // file_data nur überschreiben, wenn neue Bytes mitkommen (sonst bestehende behalten).
  update(id, { name, source_type, source_value, file_data, sort_order }) {
    if (file_data !== undefined && file_data !== null) {
      return db().run(
        'UPDATE vertragsformulare SET name=?, source_type=?, source_value=?, file_data=?, sort_order=? WHERE id=?',
        [name, source_type, source_value, file_data, sort_order ?? 0, id]
      );
    }
    return db().run(
      'UPDATE vertragsformulare SET name=?, source_type=?, source_value=?, sort_order=? WHERE id=?',
      [name, source_type, source_value, sort_order ?? 0, id]
    );
  },

  deleteById(id) {
    return db().run('DELETE FROM vertragsformulare WHERE id=?', [id]);
  },
};
