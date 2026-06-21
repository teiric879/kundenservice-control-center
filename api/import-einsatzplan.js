/**
 * Excel-Import: NEU Einsatzplan_2026 inkl. Auswertung.xlsx → einsatzplan.sqlite
 * Aufruf: node api/import-einsatzplan.js
 *
 * Excel-Struktur je Monatsblatt:
 *   Row 0: ["KW", nr, dateSerial(Mo), ...(20 cols)..., dateSerial(Di), ..., dateSerial(Mi), ..., dateSerial(Do), ..., dateSerial(Fr)]
 *   Row 1: Location labels (Kall / Kuchenheim / HomeOffice), repeated per day
 *   Row 2: Slot labels (B1,B2,Z,B1,B2,B3,BO1-BO5,H1-H7), repeated per day
 *   Rows 3-18: half-hour time slots: col0=time_from(frac), col1=time_to(frac), dann Kürzel je Slot+Tag
 *   Rows 20+: agent notes (name, kürzel, notetext)
 *
 * Je Tag starten die Slot-Spalten bei dayStartCol = 2, 22, 42, 62, 82
 * Offset innerhalb eines Tages:
 *   +0=Kall B1, +1=Kall B2,  +3=EK Z, +4=EK B1, +5=EK B2, +6=EK B3,
 *   +7=EK BO1, +8=EK BO2, +9=EK BO3, +10=EK BO4, +11=EK BO5,
 *   +13=HO H1, +14=HO H2, +15=HO H3, +16=HO H4, +17=HO H5, +18=HO H6, +19=HO H7
 */

const path  = require('path');
const XLSX  = require('xlsx');
const { DatabaseSync } = require('node:sqlite');

const EXCEL_PATH = path.join(process.env.USERPROFILE || 'C:/Users/marck', 'Downloads',
  'NEU Einsatzplan_2026 inkl. Auswertung.xlsx');
const DB_PATH = path.join(__dirname, 'db', 'einsatzplan.sqlite');

// Slot-Offset → {location, slot}
const SLOT_OFFSETS = [
  { off: 0,  location: 'kall',       slot: 'B1'  },
  { off: 1,  location: 'kall',       slot: 'B2'  },
  { off: 3,  location: 'euskirchen', slot: 'Z'   },
  { off: 4,  location: 'euskirchen', slot: 'B1'  },
  { off: 5,  location: 'euskirchen', slot: 'B2'  },
  { off: 6,  location: 'euskirchen', slot: 'B3'  },
  { off: 7,  location: 'euskirchen', slot: 'BO1' },
  { off: 8,  location: 'euskirchen', slot: 'BO2' },
  { off: 9,  location: 'euskirchen', slot: 'BO3' },
  { off: 10, location: 'euskirchen', slot: 'BO4' },
  { off: 11, location: 'euskirchen', slot: 'BO5' },
  { off: 13, location: 'homeoffice', slot: 'H1'  },
  { off: 14, location: 'homeoffice', slot: 'H2'  },
  { off: 15, location: 'homeoffice', slot: 'H3'  },
  { off: 16, location: 'homeoffice', slot: 'H4'  },
  { off: 17, location: 'homeoffice', slot: 'H5'  },
  { off: 18, location: 'homeoffice', slot: 'H6'  },
  { off: 19, location: 'homeoffice', slot: 'H7'  },
];

// Day start columns (Mon-Fri)
const DAY_START_COLS = [2, 22, 42, 62, 82];

function pad2(n) { return String(n).padStart(2, '0'); }

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 40000) return null;
  const ms = (serial - 25569) * 86400 * 1000;
  const d  = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
}

function fracToTime(frac) {
  if (!frac || typeof frac !== 'number') return null;
  const totalMin = Math.round(frac * 24 * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function isWeekday(iso) {
  if (!iso) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day >= 1 && day <= 5;
}

// ── DB Setup ─────────────────────────────────────────────────────────────────
console.log('Öffne DB:', DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

const agents = db.prepare('SELECT id, name, kuerzel FROM ep_agents').all();
const agentByKz = Object.fromEntries(agents.map(a => [a.kuerzel.toUpperCase().trim(), a.id]));
console.log(`Berater in DB: ${agents.map(a => a.kuerzel).join(', ')}`);

const insStmt = db.prepare(`
  INSERT OR IGNORE INTO ep_assignments (date, location, slot, agent_id, time_from, time_to)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let imported = 0;
let skipped  = 0;
const unknown = new Set();

// ── Excel lesen ──────────────────────────────────────────────────────────────
console.log('\nLese Excel:', EXCEL_PATH);
const wb = XLSX.readFile(EXCEL_PATH);

const MONTH_SHEETS = ['Januar','Februar ','März','April','Mai','Juni',
                      'Juli','August','September','Oktober','November','Dezember'];

for (const sheetName of MONTH_SHEETS) {
  if (!wb.SheetNames.includes(sheetName)) {
    console.log(`  Blatt nicht gefunden: "${sheetName}"`);
    continue;
  }

  const sheet = wb.Sheets[sheetName];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`\nBlatt: "${sheetName}" (${rows.length} Zeilen)`);

  // Find all KW header rows: col0='KW' or col1 is KW-number + col2 is Excel date serial
  const kwRows = [];
  for (let r = 0; r < rows.length; r++) {
    const c0 = String(rows[r][0]).toUpperCase().trim();
    const c1 = rows[r][1];
    const c2 = rows[r][2];
    const isKwRow = c0 === 'KW'
      || (typeof c1 === 'number' && c1 >= 1 && c1 <= 53
          && typeof c2 === 'number' && c2 > 40000 && c2 < 55000);
    if (isKwRow) kwRows.push(r);
  }
  console.log(`  KW-Zeilen bei: ${kwRows.join(', ')}`);

  for (const kwRow of kwRows) {
    // Extract dates for each day from the KW row
    const dayDates = DAY_START_COLS.map(col => {
      const val = rows[kwRow][col];
      const iso = excelDateToISO(typeof val === 'number' ? val : null);
      return iso && iso.startsWith('2026') && isWeekday(iso) ? iso : null;
    });

    // Data rows start at kwRow + 3 (skip KW, location, slot header rows)
    // End before next KW row or end of sheet
    const nextKwRow = kwRows.find(r => r > kwRow) ?? rows.length;
    const dataRows = [];
    for (let r = kwRow + 3; r < nextKwRow; r++) {
      const tf = rows[r][0];
      const tt = rows[r][1];
      if (typeof tf === 'number' && tf > 0 && tf < 1) {
        dataRows.push({ r, timeFrom: fracToTime(tf), timeTo: fracToTime(tt) });
      }
    }

    if (!dataRows.length) continue;

    // For each day × slot: collect agent spans
    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const iso = dayDates[dayIdx];
      if (!iso) continue;
      const dayStartCol = DAY_START_COLS[dayIdx];

      for (const { off, location, slot } of SLOT_OFFSETS) {
        const col = dayStartCol + off;

        // Collect consecutive runs of same agent
        const runs = []; // [{kz, timeFrom, timeTo}]
        let curKz = null;
        let curFrom = null;
        let curTo = null;

        for (const { timeFrom, timeTo } of dataRows) {
          const kz = String(rows[dataRows.find(d=>d.timeFrom===timeFrom).r]?.[col] || '').trim().toUpperCase();
          if (!kz) {
            if (curKz) { runs.push({ kz: curKz, timeFrom: curFrom, timeTo: curTo }); curKz = null; }
            continue;
          }
          if (kz === curKz) {
            curTo = timeTo; // extend run
          } else {
            if (curKz) runs.push({ kz: curKz, timeFrom: curFrom, timeTo: curTo });
            curKz = kz; curFrom = timeFrom; curTo = timeTo;
          }
        }
        if (curKz) runs.push({ kz: curKz, timeFrom: curFrom, timeTo: curTo });

        // Insert each run
        for (const run of runs) {
          const agentId = agentByKz[run.kz] ?? null;
          if (!agentId) {
            unknown.add(run.kz);
            skipped++;
            continue;
          }
          try {
            insStmt.run(iso, location, slot, agentId, run.timeFrom, run.timeTo);
            imported++;
          } catch {
            skipped++;
          }
        }
      }
    }
  }
}

console.log(`\n✅ Import abgeschlossen`);
console.log(`   Eingetragen : ${imported}`);
console.log(`   Übersprungen: ${skipped}`);
if (unknown.size) {
  console.log(`   Unbekannte Kürzel: ${[...unknown].join(', ')}`);
  console.log(`   → Bitte im Einsatzplaner manuell anlegen oder Kürzel in DB prüfen`);
}
