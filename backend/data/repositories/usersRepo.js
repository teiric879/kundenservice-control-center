const { getDb } = require('../driver');

function db() { return getDb('produkte'); }

async function findByUsername(username) {
  return db().get('SELECT * FROM users WHERE username = ?', [username]);
}

async function listAll() {
  return db().all('SELECT id, username, modules, is_admin, created_at FROM users ORDER BY id');
}

async function create({ username, passwordHash, modules = [], isAdmin = false }) {
  const r = await db().run(
    'INSERT INTO users (username, password_hash, modules, is_admin) VALUES (?,?,?,?)',
    [username, passwordHash, JSON.stringify(modules), isAdmin ? 1 : 0],
  );
  return r.lastInsertRowid;
}

async function update(id, { passwordHash, modules, isAdmin }) {
  const fields = [];
  const args = [];
  if (passwordHash !== undefined) { fields.push('password_hash = ?'); args.push(passwordHash); }
  if (modules !== undefined) { fields.push('modules = ?'); args.push(JSON.stringify(modules)); }
  if (isAdmin !== undefined) { fields.push('is_admin = ?'); args.push(isAdmin ? 1 : 0); }
  if (!fields.length) return;
  args.push(id);
  await db().run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, args);
}

async function remove(id) {
  await db().run('DELETE FROM users WHERE id = ?', [id]);
}

async function count() {
  const r = await db().get('SELECT COUNT(*) as n FROM users');
  return r ? r.n : 0;
}

module.exports = { findByUsername, listAll, create, update, remove, count };
