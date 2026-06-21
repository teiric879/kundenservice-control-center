const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
const fs = require('fs');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function openDb(name) {
  const db = new DatabaseSync(path.join(DB_DIR, name));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  return db;
}

let _produkte = null;
let _besucher = null;
let _einsatzplaner = null;

function getProdukte() {
  if (!_produkte) _produkte = openDb('produkte.sqlite');
  return _produkte;
}

function getBesucher() {
  if (!_besucher) _besucher = openDb('besucher.sqlite');
  return _besucher;
}

function getEinsatzplaner() {
  if (!_einsatzplaner) _einsatzplaner = openDb('einsatzplan.sqlite');
  return _einsatzplaner;
}

module.exports = { getProdukte, getBesucher, getEinsatzplaner };
