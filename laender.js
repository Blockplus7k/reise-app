// Länder: welche Länder bereist / gelebt / Wunsch – bunte Weltkarte, Zähler, Liste nach Kontinent.
// Gespeichert im IndexedDB-Store "laender" ({code: ISO2, status}); Länder aus besuchten Orten zählen automatisch mit.
const UN = "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW VA PS".split(" ");
const UN_SET = new Set(UN);
// Deine Länder aus der „been“-App (Stand 23.11.2026), werden beim ersten Start einmal übernommen
const START_BEREIST = "TR AL AT BE BA HR CY CZ DK FR DE HU IS IE IT LI MD MC ME NL NO PL PT SK ES SE CH GB US GL".split(" ");
const LFARBE = { besucht: "#f59e0b", gelebt: "#22c55e", wunsch: "#8b5cf6" };
const LNAME = { besucht: "Bereist", gelebt: "Gelebt", wunsch: "Wunsch" };
const KONT_REIHE = ["Europa", "Asien", "Nordamerika", "Südamerika", "Afrika", "Ozeanien", "Antarktis"];
const regionDE = new Intl.DisplayNames(["de"], { type: "region" });
const flagge = (c) => String.fromCodePoint(...[...c].map((x) => 0x1f1a5 + x.charCodeAt(0)));

let laenderDaten = [], welt = null, landInfo = {}, segment = "besucht", overlay = null;

// Land-Name (aus Orten, deutsch) → ISO2
// Name → ISO2 über eine einmal gebaute Tabelle (vorher: Schleife über alle Länder bei jedem Aufruf → App hing)
let nameTabelle = null;
function isoVonName(n) {
  if (!n) return null;
  if (!nameTabelle) {
    if (!Object.keys(landInfo).length) return null;
    nameTabelle = new Map(Object.entries({ "USA": "US", "Vereinigtes Königreich": "GB", "England": "GB", "Schottland": "GB", "Wales": "GB", "Türkei": "TR", "Tschechien": "CZ", "Moldawien": "MD", "Moldau": "MD" }));
    for (const c in landInfo) { if (!nameTabelle.has(landInfo[c].de)) nameTabelle.set(landInfo[c].de, c); const d = regionDE.of(c); if (d && !nameTabelle.has(d)) nameTabelle.set(d, c); }
  }
  return nameTabelle.get(n) || null;
}
// Status je Land: gespeicherter Eintrag gewinnt, sonst aus Orten abgeleitet
function statusMap() {
  const m = {};
  for (const o of orte) {
    const c = isoVonName(o.land); if (!c) continue;
    if (o.status === "besucht") m[c] = "besucht";
    else if ((o.status === "idee" || o.status === "geplant") && !m[c]) m[c] = "wunsch";
  }
  for (const l of laenderDaten) { if (l.status === "keins") delete m[l.code]; else m[l.code] = l.status; }
  return m;
}
const warDort = (s) => s === "besucht" || s === "gelebt";

// Kopf auf der Karte: Zähler für den gewählten Reiter (Bereist / Gelebt / Wunsch)
const imSegment = (st) => (segment === "besucht" ? warDort(st) : st === segment);
function zeichneLaender() {
  if (!welt) return;
  const m = statusMap();
  const codes = Object.keys(m).filter((c) => imSegment(m[c]));
  const n = codes.filter((c) => UN_SET.has(c)).length, extra = codes.length - n;
  const pz = Math.floor((n / UN.length) * 100);
  const label = segment === "wunsch" ? "Ländern auf der Wunschliste" : segment === "gelebt" ? "Ländern gelebt" : "Ländern bereist";
  $("#laender").innerHTML = `<div class="zahlen"><span class="gross">${n}</span><span>von ${UN.length} ${label}</span><span class="prozent">${pz} %</span></div>
    <div class="balken"><i style="width:${Math.max(1, (n / UN.length) * 100)}%;background:${LFARBE[segment]}"></i></div>
    <small>${segment === "wunsch" ? "" : `Noch ${UN.length - n} Länder offen`}${extra ? ` · +${extra} weitere Gebiete` : ""}</small>`;
  $("#laender").onclick = laenderMenue;
  zeichneOverlay(m);
}
// Länder auf der Hauptkarte bunt: Farbe je Status, antippen = Land-Details
function zeichneOverlay(m) {
  if (overlay) overlay.remove();
  overlay = L.geoJSON({ type: "FeatureCollection", features: welt.features.filter((f) => m[f.properties.iso]) }, {
    style: (f) => { const st = m[f.properties.iso], an = imSegment(st);
      return { weight: an ? 1.2 : 0.6, color: LFARBE[st], opacity: an ? 0.9 : 0.3, fillColor: LFARBE[st], fillOpacity: an ? 0.38 : 0.08 }; },
    onEachFeature: (f, l) => l.on("click", (e) => { if (map.getZoom() < 7) { L.DomEvent.stop(e); landSheet(f.properties.iso); } }),
  }).addTo(map);
  overlay.bringToBack();
}
// Titelbild eines Landes: erstes Webseiten-Foto eines Orts dort
function landBild(c) {
  const o = orte.find((x) => x.webFotos?.length && isoVonName(x.land) === c);
  // Kein Webseiten-Foto → Platzhalter, wird danach mit einem Reise-Foto des Landes gefüllt (fuelleLandBilder)
  return o ? `<img src="${o.webFotos[0]}-klein.webp" loading="lazy" alt="">` : `<span class="leer flagge-gross" data-landbild="${c}">${flagge(c)}</span>`;
}
// Reise-Fotos eines Landes: Fotos aus Reisen in dieses Land + Fotos, deren GPS im Land liegt
function fotosImLand(c, alle) {
  const rIds = new Set(reisen.filter((r) => r.land === c).map((r) => r.id));
  return alle.filter((f) => rIds.has(f.reiseId) || (f.lat != null && landFuerPunkt(f.lat, f.lon) === c));
}
async function fuelleLandBilder() {
  const plaetze = [...document.querySelectorAll("[data-landbild]")]; if (!plaetze.length) return;
  const alle = await DB.all("fotos");
  for (const p of plaetze) { const f = fotosImLand(p.dataset.landbild, alle)[0]; if (!f || !p.isConnected) continue;
    const u = URL.createObjectURL(f.thumb); urls.push(u); p.outerHTML = `<img src="${u}" alt="">`; }
}
// Welches Land liegt an diesem Punkt? (Punkt-in-Polygon über die Länderumrisse, mit Rahmen-Vorfilter)
const bboxCache = new Map();
function landFuerPunkt(lat, lon) {
  // Exakt, sonst mit kleiner Toleranz (Küsten, Kleinstaaten – die Umrisse sind vereinfacht)
  for (const d of [0, 0.03, 0.08, 0.15]) for (const [a, b] of d ? [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]] : [[0, 0]]) {
    const c = landExakt(lat + a, lon + b); if (c) return c; }
  return null;
}
function landExakt(lat, lon) {
  if (!welt || lat == null || lon == null) return null;
  const innen = (ring) => { let drin = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) drin = !drin; }
    return drin; };
  for (const f of welt.features) {
    let b = bboxCache.get(f); if (!b) { b = L.geoJSON(f).getBounds(); bboxCache.set(f, b); }
    if (!b.contains([lat, lon])) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some((p) => innen(p[0]) && !p.slice(1).some(innen))) return f.properties.iso;
  }
  return null;
}
// Länder aus Foto-Standorten und Reisen automatisch als bereist eintragen (nur wenn noch nicht bereist/gelebt)
async function laenderAusFotos(alleFotos) {
  const alle = alleFotos || (await DB.all("fotos"));
  const heute = new Date().toISOString().slice(0, 10);
  const codes = new Set(alle.filter((f) => f.lat != null).map((f) => landFuerPunkt(f.lat, f.lon)).filter(Boolean));
  for (const r of reisen) if (r.land && r.von && r.von <= heute) codes.add(r.land);
  const m = statusMap(); let neu = 0;
  for (const c of codes) if (!warDort(m[c])) { await DB.put("laender", { code: c, status: "besucht" }); neu++; }
  if (neu) { laenderDaten = await DB.all("laender"); zeichneLaender(); }
  return neu;
}
const landName = (c) => regionDE.of(c) || landInfo[c]?.de || c;
function grenzenVon(c) {
  const f = welt.features.find((x) => x.properties.iso === c); if (!f) return null;
  const g = f.geometry;
  if (g.type !== "MultiPolygon") return L.geoJSON(f).getBounds();
  const flaeche = (b) => (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
  return g.coordinates.map((p) => L.polygon(p.map((r) => r.map(([x, y]) => [y, x]))).getBounds()).sort((a, b) => flaeche(b) - flaeche(a))[0];
}
function zeigeLandAufKarte(c) { const b = grenzenVon(c); if (b) map.fitBounds(b, { padding: [20, 20], maxZoom: 9 }); }
function zoomeLand(c) {
  const f = welt.features.find((x) => x.properties.iso === c);
  landFilter = c; schliesseSheet(); zeichneKarte();
  $("#b-laenderwahl").textContent = `${flagge(c)} ${landName(c)} ▾`;
  if (!f) return;
  // Bei Ländern mit Überseegebieten auf den größten Teil zoomen
  let g = f.geometry;
  if (g.type === "MultiPolygon") { const flaeche = (p) => { const b = L.polygon(p).getBounds(); return (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest()); };
    const groesste = g.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [y, x]))).sort((a, b) => flaeche(b) - flaeche(a))[0];
    map.fitBounds(L.polygon(groesste).getBounds(), { padding: [20, 20], maxZoom: 9 }); }
  else map.fitBounds(L.geoJSON(f).getBounds(), { padding: [20, 20], maxZoom: 9 });
}
function alleLaender() {
  landFilter = ""; schliesseSheet(); zeichneKarte(); $("#b-laenderwahl").textContent = "🌍 Alle Länder ▾"; map.setView([35, 10], 2);
}
// Aufklapp-Menü: alle Länder des Reiters mit Bild, gruppiert nach Kontinent
function landKachel(c, m) {
  const n = orte.filter((o) => isoVonName(o.land) === c).length;
  const st = m[c] ? LNAME[m[c]] : "";
  return `<button class="landkachel" onclick="zoomeLand('${c}')">${landBild(c)}<span><b>${flagge(c)} ${esc(landName(c))}</b><small>${[st, n ? `${n} Orte` : ""].filter(Boolean).join(" · ") || (UN_SET.has(c) ? "UN" : "Gebiet")}</small></span></button>`;
}
function laenderMenue() {
  const m = statusMap();
  const codes = Object.keys(m).filter((c) => imSegment(m[c]));
  const gruppen = {};
  for (const c of codes) { const k = landInfo[c]?.k || "Sonstige"; (gruppen[k] ||= []).push(c); }
  const liste = Object.keys(gruppen).sort((a, b) => KONT_REIHE.indexOf(a) - KONT_REIHE.indexOf(b)).map((k) => `<h3>${k} (${gruppen[k].length})</h3><div class="landgitter">` +
      gruppen[k].sort((a, b) => landName(a).localeCompare(landName(b), "de")).map((c) => landKachel(c, m)).join("") + "</div>").join("") || `<p class="hint">Noch keine Länder in „${LNAME[segment]}“.</p>`;
  oeffneSheet(`<div class="sheet-head"><h2>${LNAME[segment]} (${codes.length})</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <input id="lm-such" type="search" placeholder="🔍 Land suchen …" autocomplete="off">
    <div class="row"><button onclick="alleLaender()">🌍 Ganze Welt</button><button onclick="landSuche()">+ Land</button></div>
    <div id="lm-liste">${liste}</div>`);
  fuelleLandBilder();
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  $("#lm-such").oninput = (e) => {
    const q = norm(e.target.value.trim());
    if (!q) return ($("#lm-liste").innerHTML = liste);
    // Suche über alle Länder: eingetragene zuerst
    const treffer = Object.keys(landInfo).filter((c) => norm(landName(c)).includes(q))
      .sort((a, b) => (m[a] ? 0 : 1) - (m[b] ? 0 : 1) || landName(a).localeCompare(landName(b), "de")).slice(0, 24);
    $("#lm-liste").innerHTML = treffer.length ? `<div class="landgitter">${treffer.map((c) => landKachel(c, m)).join("")}</div>` : `<p class="hint">Kein Land gefunden.</p>`;
    fuelleLandBilder();
  };
}
$("#b-laenderwahl").onclick = laenderMenue;

async function setzeLand(c, status) {
  await DB.put("laender", { code: c, status }); laenderDaten = await DB.all("laender");
  schliesseSheet(); zeichneLaender();
}
function landSheet(c) {
  const m = statusMap(), s = m[c];
  const orteHier = orte.filter((o) => isoVonName(o.land) === c);
  oeffneSheet(`<div class="sheet-head"><h2>${flagge(c)} ${esc(regionDE.of(c) || c)}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta">${esc(landInfo[c]?.k || "")}${UN_SET.has(c) ? " · UN-Mitglied" : " · zählt nicht zu den 195"}${s ? ` · aktuell: ${LNAME[s]}` : ""}</p>
    <div class="row">${["besucht", "gelebt", "wunsch"].map((x) => `<button onclick="setzeLand('${c}','${x}')" style="${s === x ? `background:${LFARBE[x]};color:#111;border:0` : ""}">${LNAME[x]}</button>`).join("")}</div>
    <div class="row"><button onclick="zoomeLand('${c}')">🗺️ Auf Karte zeigen</button>${s ? `<button onclick="setzeLand('${c}','keins')">Entfernen</button>` : ""}</div>
    ${reisen.filter((r) => r.land === c).map((r) => `<div class="item" onclick="zeigeOrdner('${r.id}')"><span>📁</span><div><b>${esc(r.titel)}</b><small>${esc(r.von || "")} – ${esc(r.bis || "")}</small></div></div>`).join("")}
    ${orteHier.length ? `<h3>Orte (${orteHier.length})</h3>` + orteHier.map((o) => `<div class="item" onclick="zeigeOrt('${o.id}')"><span class="dot" style="background:${FARBE[o.status]}"></span><div><b>${esc(o.name)}</b><small>${esc(o.status)}</small></div></div>`).join("") : ""}`);
}
// Land hinzufügen: bereits eingetragene Länder werden markiert und nur bearbeitet, nie doppelt angelegt
function landSuche() {
  const m = statusMap();
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const alle = Object.keys(landInfo).map((c) => [c, landName(c)]).sort((a, b) => (m[a[0]] ? 0 : 1) - (m[b[0]] ? 0 : 1) || a[1].localeCompare(b[1], "de"));
  oeffneSheet(`<div class="sheet-head"><h2>Land hinzufügen</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <input id="land-such" placeholder="Land suchen…" autocomplete="off"><div id="land-treffer"></div>`);
  const zeig = (q) => { q = norm(q); $("#land-treffer").innerHTML = alle.filter(([, n]) => norm(n).includes(q)).slice(0, 40)
    .map(([c, n]) => `<button class="treffer" onclick="landSheet('${c}')">${flagge(c)} ${esc(n)}${m[c] ? ` <small class="schon">✓ ${LNAME[m[c]]} – bearbeiten</small>` : ""}</button>`).join(""); };
  $("#land-such").oninput = (e) => zeig(e.target.value); zeig(""); $("#land-such").focus();
}
document.querySelectorAll("#seg button").forEach((b) => (b.onclick = () => {
  segment = b.dataset.s; document.querySelectorAll("#seg button").forEach((x) => x.classList.toggle("on", x === b)); zeichneLaender();
}));

(async () => {
  welt = await fetch("welt.geojson").then((r) => r.json());
  for (const f of welt.features) landInfo[f.properties.iso] = f.properties;
  laenderDaten = await DB.all("laender");
  if (!laenderDaten.length) { for (const c of START_BEREIST) await DB.putRaw("laender", { code: c, status: "besucht", geaendert: 0 }); laenderDaten = await DB.all("laender"); }
  zeichneLaender();
  zeichneKarte(); // Reise-Pins brauchen die Landesmitten
  setTimeout(() => laenderAusFotos(), 2500); // rückwirkend: Länder aus vorhandenen Reise-Fotos eintragen
})();
