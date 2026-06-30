import com.healthmarketscience.jackcess.*;
import java.io.*;
import java.util.*;

/**
 * Liest die beiden enet-NNE-Access-Datenbanken (Strom + Gas) und schreibt eine
 * kompakte JSON-Liste PLZ -> {Netzbetreiber, Grundversorger} (+ Telefon/Website,
 * je nach Verfuegbarkeit) fuer Strom und Gas.
 *
 * Aufruf:  java EnetExport <nns_access.accdb> <nng_access.accdb> <out.json>
 *
 * Ausgabeformat (Array):
 *   [{ "plz":"53879","ort":"Euskirchen","sparte":"strom",
 *      "nb_name":"Westnetz GmbH","nb_tel":"0800/...","nb_url":"https://...",
 *      "gv_name":"E.ON Energie Deutschland GmbH","gv_tel":"" }, ... ]
 *
 * Vorgabe: Strom-GV (EVU) hat keine Kontaktdaten -> nur Name. Gas-GV nur Telefon.
 */
public class EnetExport {

  static class Op { String name = "", tel = "", url = "", email = ""; }

  public static void main(String[] args) throws Exception {
    String stromDb = args[0], gasDb = args[1], outPath = args[2];

    StringBuilder out = new StringBuilder();
    out.append("[");
    int[] count = { 0 };

    try (Database db = DatabaseBuilder.open(new File(stromDb))) {
      exportStrom(db, out, count);
    }
    try (Database db = DatabaseBuilder.open(new File(gasDb))) {
      exportGas(db, out, count);
    }

    out.append("\n]\n");
    try (Writer w = new OutputStreamWriter(new FileOutputStream(outPath), "UTF-8")) {
      w.write(out.toString());
    }
    System.out.println("[EnetExport] " + count[0] + " Datensaetze -> " + outPath);
  }

  // ── Strom ─────────────────────────────────────────────────────────────────
  static void exportStrom(Database db, StringBuilder out, int[] count) throws IOException {
    Map<Long, Op> nb = new HashMap<>();
    for (Row r : db.getTable("Netzbetreiber")) {
      Long nr = num(r.get("VNB_Nr"));
      if (nr == null) continue;
      Op o = new Op();
      o.name = str(r.get("Netzbetreiber_Name"));
      o.tel  = str(r.get("Tel"));
      o.url  = normUrl(str(r.get("Internet")));
      nb.put(nr, o);
    }
    Map<Long, String> evu = new HashMap<>();
    for (Row r : db.getTable("EVU")) {
      Long nr = num(r.get("EVU_Nr"));
      if (nr != null) evu.put(nr, str(r.get("EVU_Name")));
    }
    // Netz_Nr -> {VNB_Nr, Grundversorger_Nr} + Ansprechpartner-E-Mail (best-effort)
    Map<Long, long[]> netze = new HashMap<>();
    Map<Long, String> netzeEmail = new HashMap<>();
    for (Row r : db.getTable("Netze")) {
      Long nr = num(r.get("Netz_Nr"));
      if (nr == null) continue;
      netze.put(nr, new long[]{ z(num(r.get("VNB_Nr"))), z(num(r.get("Grundversorger_Nr"))) });
      netzeEmail.put(nr, normMail(str(r.get("Ansprechp_email"))));
    }

    Set<String> seen = new HashSet<>();
    for (Row r : db.getTable("Postleitzahlen_Netzbetreiber")) {
      if (!gueltig(r.get("gueltig_bis"))) continue;
      Long plz = num(r.get("PLZ"));
      if (plz == null) continue;
      String ort = str(r.get("Ort"));
      String key = plz + "|" + ort;
      if (!seen.add(key)) continue;

      Long netzNr = num(r.get("Netz_Nr"));
      Op o = null; String gvName = ""; String nbEmail = "";
      if (netzNr != null && netze.containsKey(netzNr)) {
        long[] n = netze.get(netzNr);
        o = nb.get(n[0]);
        gvName = evu.getOrDefault(n[1], "");
        nbEmail = netzeEmail.getOrDefault(netzNr, "");
      }
      writeRow(out, count, plz, ort, "strom",
        o != null ? o.name : "", o != null ? o.tel : "", o != null ? o.url : "", nbEmail,
        gvName, "");
    }
  }

  // ── Gas ───────────────────────────────────────────────────────────────────
  static void exportGas(Database db, StringBuilder out, int[] count) throws IOException {
    Map<Long, Op> nb = new HashMap<>();
    for (Row r : db.getTable("NetzBetreiber")) {
      Long nr = num(r.get("VNBG_Nr"));
      if (nr == null) continue;
      Op o = new Op();
      o.name  = str(r.get("Betreiber_Name"));
      o.tel   = str(r.get("Tel"));
      o.url   = normUrl(str(r.get("Internet")));
      o.email = normMail(str(r.get("Ansprechpartner_eMail")));
      nb.put(nr, o);
    }
    Map<Long, Op> gv = new HashMap<>();
    for (Row r : db.getTable("Gasversorger")) {
      Long nr = num(r.get("GVU_Nr"));
      if (nr == null) continue;
      Op o = new Op();
      o.name = str(r.get("GVU_Name"));
      o.tel  = str(r.get("Tel"));
      gv.put(nr, o);
    }

    Set<String> seen = new HashSet<>();
    for (Row r : db.getTable("PLZ_Netzbetreiber_Gas")) {
      if (!gueltig(r.get("Gueltig_bis"))) continue;
      Long plz = num(r.get("PLZ"));
      if (plz == null) continue;
      String ort = str(r.get("Ort"));
      String key = plz + "|" + ort;
      if (!seen.add(key)) continue;

      Op o  = nb.get(num(r.get("ND_VNBG_Nr")));
      Op g  = gv.get(num(r.get("Grundversorger_Nr")));
      writeRow(out, count, plz, ort, "gas",
        o != null ? o.name : "", o != null ? o.tel : "", o != null ? o.url : "", o != null ? o.email : "",
        g != null ? g.name : "", g != null ? g.tel : "");
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  static void writeRow(StringBuilder out, int[] count, Long plz, String ort, String sparte,
                       String nbName, String nbTel, String nbUrl, String nbEmail, String gvName, String gvTel) {
    if (count[0] > 0) out.append(",");
    out.append("\n{");
    out.append("\"plz\":\"").append(plzPad(plz)).append("\",");
    out.append("\"ort\":\"").append(esc(ort)).append("\",");
    out.append("\"sparte\":\"").append(sparte).append("\",");
    out.append("\"nb_name\":\"").append(esc(nbName)).append("\",");
    out.append("\"nb_tel\":\"").append(esc(nbTel)).append("\",");
    out.append("\"nb_url\":\"").append(esc(nbUrl)).append("\",");
    out.append("\"nb_email\":\"").append(esc(nbEmail)).append("\",");
    out.append("\"gv_name\":\"").append(esc(gvName)).append("\",");
    out.append("\"gv_tel\":\"").append(esc(gvTel)).append("\"}");
    count[0]++;
  }

  // E-Mail säubern: nur erste Zeile, keine Umbrüche; offensichtlich leere/ungültige verwerfen.
  static String normMail(String m) {
    if (m == null) return "";
    m = m.trim();
    if (m.contains("\n")) m = m.split("\\n")[0].trim();
    return m.contains("@") ? m : "";
  }

  static String plzPad(Long plz) {
    String s = String.valueOf(plz);
    while (s.length() < 5) s = "0" + s;
    return s;
  }
  static Long num(Object o) { return (o instanceof Number) ? ((Number) o).longValue() : null; }
  static long z(Long l) { return l == null ? 0L : l; }
  static String str(Object o) { return o == null ? "" : o.toString().trim(); }

  static String normUrl(String u) {
    if (u == null || u.isEmpty()) return "";
    u = u.trim();
    if (u.contains("\n")) u = u.split("\\n")[0].trim();
    return u;
  }

  // gueltig_bis: leer ODER in der Zukunft -> aktuell gueltig
  static boolean gueltig(Object o) {
    if (o == null) return true;
    if (o instanceof java.util.Date) return ((java.util.Date) o).getTime() >= System.currentTimeMillis() - 86400000L;
    return true;
  }

  static String esc(String s) {
    if (s == null) return "";
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"':  b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append(" "); break;
        case '\r': break;
        case '\t': b.append(" "); break;
        default:
          if (c < 0x20) b.append(' '); else b.append(c);
      }
    }
    return b.toString();
  }
}
