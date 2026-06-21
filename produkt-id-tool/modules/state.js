export const S = {
  produkt:          'gas',
  gueltigAb:        null,
  verbrauch:        20000,
  verbrauchNT:      0,
  plz:              '',
  gebiet:           'übrige',
  ustModus:         'brutto',
  neukundenbonus:   false,
  aktionsbonus:     false,
  aktionsbonusWert: 0,
  tab:              'kunde',
  steuveTyp:        'WP',
  steuveModul:      1,
  messung:          'getrennt',   // 'getrennt' | 'gemeinschaft'
  zaehlerart:       'Einzeltarif', // 'Einzeltarif' | 'Doppeltarif' (passt zu DB-Spalte zaehlerart)
  vergleichFrei:    { ap: null, gp: null, bonus: 0 },
  vertragsbeginn:   '',
};
