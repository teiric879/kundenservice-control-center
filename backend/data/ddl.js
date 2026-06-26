// Single Source of Truth für das DB-Schema (DDL).
//
// Wird von ZWEI Pfaden konsumiert, damit beide nie auseinanderlaufen:
//   1) api/schema.js          — sync (node:sqlite), genutzt von der Access-Import-Pipeline (migrate-*.js)
//   2) api/data/schema.js     — async (libSQL/Turso), genutzt vom Server beim Boot
//
// Reihenfolge je DB: TABLES (CREATE … IF NOT EXISTS) → ALTERS (try/catch, Migration alter DBs)
// → POST_INDEXES → ggf. Registry/Seed.

const PRODUKTE_TABLES = `
  CREATE TABLE IF NOT EXISTS sparten (
    sparte     TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    ust        REAL NOT NULL DEFAULT 19,
    nkb_schwelle INTEGER NOT NULL DEFAULT 0,
    gebiete    TEXT,
    has_nt     INTEGER NOT NULL DEFAULT 0,
    produkte   TEXT NOT NULL,
    labels     TEXT NOT NULL,
    typen      TEXT,
    module     TEXT
  );

  CREATE TABLE IF NOT EXISTS gueltigkeiten (
    sparte TEXT NOT NULL,
    ga     TEXT NOT NULL,
    PRIMARY KEY (sparte, ga)
  );

  CREATE TABLE IF NOT EXISTS preise (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sparte      TEXT NOT NULL,
    ga          TEXT NOT NULL,
    v_von       INTEGER NOT NULL DEFAULT 0,
    v_bis       INTEGER NOT NULL DEFAULT 999999,
    gebiet      TEXT,
    plz         TEXT,   -- gesetzt bei per-PLZ-Preisen (externes Gebiet), sonst NULL (Gebiets-Preis)
    ort         TEXT,   -- Ortsname zur Anzeige (nur bei per-PLZ)
    produkt_key TEXT NOT NULL,
    zaehlerart  TEXT,   -- 'Einzeltarif'|'Doppeltarif' für Heizstrom, sonst NULL
    ap_b        REAL,
    gp_b        REAL,
    ap_n        REAL,
    gp_n        REAL,
    ap_nt_b     REAL,
    ap_nt_n     REAL,
    bonus       REAL NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_preise_lookup ON preise(sparte, ga, gebiet, produkt_key);

  CREATE TABLE IF NOT EXISTS konditionen (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sparte         TEXT NOT NULL,
    ga             TEXT NOT NULL,
    v_von          INTEGER NOT NULL DEFAULT 0,
    v_bis          INTEGER NOT NULL DEFAULT 999999,
    gebiet         TEXT,
    plz            TEXT,
    zaehlerart     TEXT,
    produkt_key    TEXT NOT NULL,
    pid            INTEGER DEFAULT 0,
    aid            INTEGER DEFAULT 0,
    pid_nt         INTEGER,
    aid_nt         INTEGER,
    vl             INTEGER DEFAULT 12,
    pg             INTEGER DEFAULT 12,
    alb            TEXT,
    bonus          REAL NOT NULL DEFAULT 0,
    netzentgelt_red TEXT
  );
`;

// Migrationen für bestehende DBs (auf frischer DB harmlose Duplikat-Fehler → try/catch).
const PRODUKTE_ALTERS = [
  'ALTER TABLE preise ADD COLUMN zaehlerart TEXT',
  'ALTER TABLE preise ADD COLUMN plz TEXT',
  'ALTER TABLE preise ADD COLUMN ort TEXT',
  'ALTER TABLE konditionen ADD COLUMN plz TEXT',
  'ALTER TABLE konditionen ADD COLUMN zaehlerart TEXT',
  // Herkunfts-Markierung: 'import' = aus Access/Pipeline gespiegelt, 'manuell' = im Admin gepflegt.
  "ALTER TABLE gueltigkeiten ADD COLUMN quelle TEXT DEFAULT 'import'",
  "ALTER TABLE preise        ADD COLUMN quelle TEXT DEFAULT 'import'",
  "ALTER TABLE konditionen   ADD COLUMN quelle TEXT DEFAULT 'import'",
  // Mitbewerber-Preise: Heizstrom-Varianten + SteuVE-Module (alte Spalten bleiben für Turso-Compat)
  'ALTER TABLE mitbewerber_preise ADD COLUMN heizstrom_typ TEXT',
  'ALTER TABLE mitbewerber_preise ADD COLUMN wp_messung TEXT',
  'ALTER TABLE mitbewerber_preise ADD COLUMN ns_zaehlerart TEXT',
  'ALTER TABLE mitbewerber_preise ADD COLUMN steuve_modul TEXT',
  // Korrekte Spalten (ersetzen wp_messung/ns_zaehlerart logisch)
  'ALTER TABLE mitbewerber_preise ADD COLUMN zaehlerart TEXT',
  'ALTER TABLE mitbewerber_preise ADD COLUMN ns_messung TEXT',
  // Provider-Logos (aus Scraper extrahiert)
  'ALTER TABLE mitbewerber_preise ADD COLUMN logo_url TEXT',
];

const PRODUKTE_POST_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_preise_plz ON preise(plz, sparte);
  CREATE INDEX IF NOT EXISTS idx_kond_plz   ON konditionen(plz, sparte);
`;

// Registry-Tabellen (Spiegel des SAP-/Access-Standes; alleinige Quelle für aid/pid).
const VERTRAGSFORMULARE_TABLE = `
  CREATE TABLE IF NOT EXISTS vertragsformulare (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sparte       TEXT NOT NULL,
    produkt_key  TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT 'Standardvertrag',
    source_type  TEXT NOT NULL DEFAULT 'upload',   -- 'upload' (file_data) | 'url' (source_value)
    source_value TEXT NOT NULL DEFAULT '',          -- URL bei 'url', Dateiname bei 'upload'
    file_data    TEXT,                              -- Base64-PDF bei source_type='upload'
    sort_order   INTEGER NOT NULL DEFAULT 0
  );
`;

// Migration für bereits existierende vertragsformulare-Tabellen.
const VERTRAGSFORMULARE_ALTERS = [
  'ALTER TABLE vertragsformulare ADD COLUMN file_data TEXT',
];

const PRODUKTE_REGISTRY = `
  -- Angebots-ID HT: Lookup über (sparte, AP_netto, GP_Jahr_netto). Quelle TB 602/702/802/502 (WERK=59).
  CREATE TABLE IF NOT EXISTS aid_registry (
    sparte TEXT NOT NULL,
    ap_n   REAL NOT NULL,
    gp_n   REAL NOT NULL,
    aid    INTEGER NOT NULL,
    PRIMARY KEY (sparte, ap_n, gp_n)
  );
  -- Angebots-ID NT: Lookup über (sparte, AP_netto). Quelle TB 603/803.
  CREATE TABLE IF NOT EXISTS aid_registry_nt (
    sparte TEXT NOT NULL,
    ap_n   REAL NOT NULL,
    aid_nt INTEGER NOT NULL,
    PRIMARY KEY (sparte, ap_n)
  );
  -- Produkt-ID-Map: feste Zuordnung je Produkt. Quelle vnkpf + Internal→produktKey-Map.
  CREATE TABLE IF NOT EXISTS pid_map (
    sparte      TEXT NOT NULL,
    produkt_key TEXT NOT NULL,
    zaehlerart  TEXT,
    pid         INTEGER NOT NULL,
    pid_nt      INTEGER,
    vl          INTEGER DEFAULT 12,
    pg          INTEGER DEFAULT 12,
    PRIMARY KEY (sparte, produkt_key, zaehlerart)
  );

  -- Protokoll der Daten-Uploads aus dem Admin (Besucher/Einsatzplan/Preise).
  -- Liegt zentral in der produkte-DB; alle Import-Typen loggen hierhin.
  CREATE TABLE IF NOT EXISTS import_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,        -- ISO-Zeitpunkt des Imports
    kind        TEXT NOT NULL,        -- 'besucher' | 'einsatzplan' | 'preise'
    source_file TEXT,                 -- hochgeladener Dateiname
    added       INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    detail      TEXT                  -- JSON: Bereich/Aufschlüsselung/unbekannte Kürzel …
  );
  CREATE INDEX IF NOT EXISTS idx_import_history_ts ON import_history(ts);

  -- Mitbewerber-Preise (täglich gescraped von Check24/Verivox).
  CREATE TABLE IF NOT EXISTS mitbewerber_preise (
    id               TEXT PRIMARY KEY,
    anbieter         TEXT NOT NULL,
    sparte           TEXT NOT NULL,
    heizstrom_typ    TEXT,             -- 'wp'|'ns' (nur bei sparte='heizstrom')
    zaehlerart       TEXT,             -- 'einzeltarif'|'doppeltarif' (bei WP und NS)
    ns_messung       TEXT,             -- 'getrennt'|'gemeinsam' (nur bei heizstrom_typ='ns')
    steuve_modul     TEXT,             -- 'modul1'|'modul2' (nur bei sparte='steuve')
    plz_gebiet       TEXT,
    arbeitspreis     REAL,
    grundpreis       REAL,
    bonus            REAL,
    bonus_bedingung  TEXT,
    gueltig_ab       TEXT,
    gueltig_bis      TEXT,
    quelle           TEXT NOT NULL DEFAULT 'scrape',
    aktualisiert_am  TEXT NOT NULL,
    hash_content     TEXT,
    logo_url         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mitbewerber_lookup ON mitbewerber_preise(sparte, heizstrom_typ, zaehlerart, ns_messung, steuve_modul, plz_gebiet);
  CREATE INDEX IF NOT EXISTS idx_mitbewerber_anbieter ON mitbewerber_preise(anbieter, sparte);
`;

const BESUCHER_TABLES = `
  CREATE TABLE IF NOT EXISTS besuche (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    datum     TEXT NOT NULL,
    standort  TEXT NOT NULL,
    kategorie TEXT,
    stunde    INTEGER DEFAULT -1
  );
  CREATE INDEX IF NOT EXISTS idx_besuche_datum     ON besuche(datum);
  CREATE INDEX IF NOT EXISTS idx_besuche_standort  ON besuche(standort);
  CREATE INDEX IF NOT EXISTS idx_besuche_kategorie ON besuche(kategorie);
`;

// Migration für bestehende besucher-DBs: voller Zeitstempel (aus Access 'Uhrzeit').
// Nur informativ/zukunftssicher — die Inkrement-Logik selbst dedupliziert per Datums-Cutoff.
const BESUCHER_ALTERS = [
  'ALTER TABLE besuche ADD COLUMN ts TEXT',
];

const EINSATZPLAN_TABLES = `
  CREATE TABLE IF NOT EXISTS ep_agents (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    kuerzel TEXT NOT NULL UNIQUE,
    color   TEXT NOT NULL DEFAULT '#3BE8C4',
    active  INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS ep_assignments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,
    location  TEXT NOT NULL,
    slot      TEXT NOT NULL,
    agent_id  INTEGER NOT NULL REFERENCES ep_agents(id),
    time_from TEXT NOT NULL DEFAULT '08:00',
    time_to   TEXT NOT NULL DEFAULT '16:00',
    UNIQUE(date, location, slot, time_from)
  );
  CREATE INDEX IF NOT EXISTS idx_ep_asgn_date ON ep_assignments(date);

  CREATE TABLE IF NOT EXISTS ep_notes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,
    agent_id  INTEGER NOT NULL REFERENCES ep_agents(id),
    text      TEXT NOT NULL,
    UNIQUE(date, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ep_notes_date ON ep_notes(date);
`;

const INITIAL_AGENTS = [
  ['Susanne Elste',     'SE', '#3BE8C4'],
  ['Nina Dahmen',       'ND', '#E9C682'],
  ['Aldona Marusczyk',  'AM', '#F08AB0'],
  ['Chantal Siyah',     'CS', '#7A8BF0'],
  ['Lara Maria Jansen', 'LJ', '#5FD6A0'],
  ['Sofie Bierschenk',  'SB', '#56C8E8'],
  ['Stefan Mertens',    'MS', '#E8A06A'],
  ['Annette Arnold',    'AA', '#B69CF5'],
  ['Veronika Schulz',   'VS', '#FF8A78'],
  ['Kerstin Krause',    'KK', '#3BE8A6'],
  ['Christine Seifert', 'SC', '#39A0D6'],
  ['Vanessa Ventura',   'VV', '#22C3B6'],
  ['Lena Scholl',       'LS', '#F59E0B'],
  ['Nathalie Knappe',   'NK', '#a78bfa'],
  ['Marc Klens',        'MK', '#34d399'],
  ['Lydia Kaufmann',    'LK', '#fb7185'],
];

module.exports = {
  PRODUKTE_TABLES,
  PRODUKTE_ALTERS,
  PRODUKTE_POST_INDEXES,
  PRODUKTE_REGISTRY,
  VERTRAGSFORMULARE_TABLE,
  VERTRAGSFORMULARE_ALTERS,
  BESUCHER_TABLES,
  BESUCHER_ALTERS,
  EINSATZPLAN_TABLES,
  INITIAL_AGENTS,
};
