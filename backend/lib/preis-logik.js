// Preis-/ID-Logik – 1:1 nachgebaut aus der Access-Pipeline (ExportPlzAll.java).
// Netto ist der Eingabe-/Schlüsselwert (SAP), Brutto wird daraus abgeleitet.
const UST = 1.19;

const r2 = (v) => Math.round(v * 100) / 100;

// Netto → Brutto. AP: ct/kWh ×1,19. GP: Jahres-Netto/12 ×1,19 (€/Monat). Gleiche Rundung wie Access.
function ableitenBrutto(apN, gpN, apNtN) {
  const out = {
    apB: apN != null ? r2(apN * UST) : null,
    gpB: gpN != null ? r2((gpN / 12) * UST) : null,
  };
  if (apNtN != null && apNtN > 0) out.apNtB = r2(apNtN * UST);
  return out;
}

// Hinweis: Die aid/pid-Auflösung (vormals resolvePid/resolveAid/resolveAidNt) liegt jetzt im
// Repository api/data/repositories/registryRepo.js — hier bleibt ausschließlich reine Rechenlogik.

module.exports = { UST, r2, ableitenBrutto };
