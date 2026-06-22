import { S } from './state.js';
import { myRound, eur, ct, fmtDate, escape, cardColors } from './helpers.js';
import { getData } from './calc.js';

export function bonusRow(bonusAmt, ustModus, ust) {
  const label   = ustModus === 'brutto' ? 'Bonus (brutto)' : 'Bonus (netto)';
  const dispVal = ustModus === 'brutto' ? bonusAmt : myRound(bonusAmt / (1 + ust / 100), 2);
  return `<div class="card-row">
    <span class="lbl">${label}</span>
    <span class="val">${dispVal > 0 ? `<span class="bonus-badge">−${eur(dispVal)}</span>` : eur(0)}</span>
  </div>`;
}

export function sachRow(lbl, val) {
  const v = String(val ?? '');
  return `<div class="sach-id-row">
    <span class="lbl">${lbl}</span>
    <span class="sach-val-group">
      <span class="val">${escape(v)}</span>
      <button class="copy-btn" data-copy="${escape(v)}" title="Kopieren" aria-label="Kopieren">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <svg class="check-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>
      </button>
    </span>
  </div>`;
}

export function buildCard(productKey, label, result, isVergleich = false, animDelay = 0, vergleich = null) {
  const [c0, c1] = isVergleich ? ['#3d2800','#5c3d00'] : cardColors(productKey);

  const vbFmt = S.vertragsbeginn
    ? new Date(S.vertragsbeginn).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})
    : null;

  const sachBlock = result.pid ? `
    <div class="card-sach sach-only">
      ${sachRow('Produkt-ID', result.pid)}
      ${sachRow('Angebots-ID', result.aid)}
      ${result.pidNt ? `<div class="sach-sep"></div>${sachRow('Produkt-ID NT', result.pidNt)}${sachRow('Angebots-ID NT', result.aidNt)}` : ''}
      <div class="sach-sep"></div>
      ${result.alb ? sachRow('ALB', result.alb) : ''}
      ${vbFmt ? sachRow('Vertragsbeginn', vbFmt) : ''}
      ${result.vertragsende ? sachRow('Vertragsende', fmtDate(result.vertragsende)) : ''}
      ${result.pgEnde ? sachRow('Preisgarantie bis', fmtDate(result.pgEnde)) : ''}
    </div>` : '';

  const apLabel = S.ustModus === 'brutto' ? 'Verbrauchspreis (brutto)' : 'Verbrauchspreis (netto)';
  const gpLabel = S.ustModus === 'brutto' ? 'Monatl. Grundpreis (brutto)' : 'Monatl. Grundpreis (netto)';
  const ntRow   = result.apNt != null ? `
    <div class="card-row">
      <span class="lbl">Verbrauchspreis NT</span>
      <span class="val">${ct(result.apNt)}</span>
    </div>` : '';

  const d = getData();

  // Ersparnis ggü. Vergleichstarif (nur auf e-regio-Karten, wenn Vergleich ausgefüllt).
  let saveBlock = '';
  if (!isVergleich && vergleich) {
    const diffJahr = myRound(vergleich.jahrespreis - result.jahrespreis, 2);
    const diffMon  = myRound(diffJahr / 12, 2);
    if (Math.abs(diffJahr) < 0.5) {
      saveBlock = `<div class="card-saving is-equal">
        <div class="save-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>
          </svg>
        </div>
        <div class="save-text">
          <span class="save-lbl">Vergleichstarif</span>
          <span class="save-amt">Gleichauf</span>
        </div>
      </div>`;
    } else if (diffJahr > 0) {
      saveBlock = `<div class="card-saving is-plus">
        <div class="save-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/>
            <polyline points="16 17 22 17 22 11"/>
          </svg>
        </div>
        <div class="save-text">
          <span class="save-lbl">Ersparnis ggü. Vergleichstarif</span>
          <span class="save-amt">${eur(diffJahr)} <small>/ Jahr</small></span>
          <span class="save-sub">≈ ${eur(diffMon)} / Monat günstiger</span>
        </div>
      </div>`;
    } else {
      saveBlock = `<div class="card-saving is-minus">
        <div class="save-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 18"/>
            <polyline points="16 7 22 7 22 13"/>
          </svg>
        </div>
        <div class="save-text">
          <span class="save-lbl">Mehrkosten ggü. Vergleichstarif</span>
          <span class="save-amt">${eur(Math.abs(diffJahr))} <small>/ Jahr</small></span>
          <span class="save-sub">≈ ${eur(Math.abs(diffMon))} / Monat teurer</span>
        </div>
      </div>`;
    }
  }

  return `<article class="price-card${isVergleich ? ' is-vergleich' : ''}" style="animation-delay:${animDelay}s">
    <div class="card-hdr" style="--card-from:${c0};--card-to:${c1}">
      <div class="prod-name">${escape(label)}</div>
      <div class="card-hero">
        <div class="price-main">
          <span class="amount">${Math.ceil(result.monatspreis).toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0})}</span>
          <span class="currency">€</span>
        </div>
        <div class="price-caption">Abschlag / Monat</div>
      </div>
    </div>
    <div class="card-body">
      <div class="card-row pg-row">
        <span class="lbl" style="font-size:11.5px;font-style:italic">${result.pgLabel || 'Vergleichspreis'}</span>
        ${result.vl ? `<span class="val" style="font-size:11.5px">${result.vl}&thinsp;Mon.</span>` : ''}
      </div>
      ${result.vl ? `<div class="card-row">
        <span class="lbl">Vertragslaufzeit</span>
        <span class="val">${result.vl} Monate</span>
      </div>` : ''}
      <div class="card-row">
        <span class="lbl">${apLabel}</span>
        <span class="val">${ct(result.ap)}</span>
      </div>
      ${ntRow}
      <div class="card-row">
        <span class="lbl">${gpLabel}</span>
        <span class="val">${eur(result.gp)}</span>
      </div>
      ${bonusRow(result.bonus, S.ustModus, d.ust)}
      ${result.netzentgeltRed ? `<div class="card-row netzentgelt-row">
        <span class="lbl">Netzentgelt-Red. §14a</span>
        <span class="val">${escape(result.netzentgeltRed)}</span>
      </div>` : ''}
      <div class="card-row highlight">
        <span class="lbl">Preis im 1. Jahr</span>
        <span class="val">${eur(result.jahrespreis)}</span>
      </div>
    </div>
    ${saveBlock}
    ${!isVergleich ? `<div class="card-footer kunde-only">
      <button class="btn-vertrag" disabled title="PDF wird später hinterlegt">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 12v6M14 12v6M8 15h8"/></svg>
        Vertragsformular
      </button>
    </div>` : ''}
    ${sachBlock}
  </article>`;
}
