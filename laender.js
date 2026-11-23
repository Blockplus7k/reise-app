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

let laenderDaten = [], welt = null, landInfo = {}, segment = "besucht", weltLayer = null, overlay = null;
const weltMap = L.map("weltkarte", { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 1, maxBounds: [[-75, -400], [85, 400]] }).setView([30, 10], 1);

// Land-Name (aus Orten, deutsch) → ISO2
function isoVonName(n) {
  if (!n) return null;
  const alias = { "USA": "US", "Vereinigtes Königreich": "GB", "England": "GB", "Schottland": "GB", "Wales": "GB", "Türkei": "TR", "Tschechien": "CZ" };
  if (alias[n]) return alias[n];
  for (const c in landInfo) if (landInfo[c].de === n || regionDE.of(c) === n) return c;
  return null;
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

// Kopfzeile auf der Karte (ersetzt die Version aus app.js)
function zeichneLaender() {
  if (!welt) return;
  const m = statusMap();
  const war = Object.keys(m).filter((c) => warDort(m[c]));
  const n = war.filter((c) => UN_SET.has(c)).length, extra = war.length - n;
  const wunsch = Object.keys(m).filter((c) => m[c] === "wunsch" && UN_SET.has(c)).length;
  const pz = Math.floor((n / UN.length) * 100);
  $("#laender").innerHTML = `<div class="zahlen"><span class="gross">${n}</span><span>von ${UN.length} Ländern bereist</span><span class="prozent">${pz} %</span></div>
    <div class="balken"><i style="width:${Math.max(1, (n / UN.length) * 100)}%"></i></div>
    <small>Noch ${UN.length - n} Länder offen${wunsch ? ` · ${wunsch} auf der Wunschliste` : ""}${extra ? ` · +${extra} weitere Gebiete` : ""}</small>`;
  $("#laender").onclick = () => wechsle("laender");
  zeichneWelt(m); zeichneUebersicht(m); zeichneOverlay(m);
}

function stil(m) {
  return (f) => { const s = m[f.properties.iso];
    return { weight: 0.6, color: "#ffffff", fillOpacity: 1, fillColor: s ? LFARBE[s] : "#d6dbd7" }; };
}
function zeichneWelt(m) {
  if (weltLayer) weltLayer.remove();
  weltLayer = L.geoJSON(welt, { style: stil(m), onEachFeature: (f, l) => l.on("click", () => landSheet(f.properties.iso)) }).addTo(weltMap);
}
// Auf der Hauptkarte: bereiste Länder leicht eingefärbt
function zeichneOverlay(m) {
  if (overlay) overlay.remove();
  overlay = L.geoJSON({ type: "FeatureCollection", features: welt.features.filter((f) => warDort(m[f.properties.iso])) },
    { interactive: false, style: { weight: 1, color: "#f59e0b", opacity: 0.6, fillColor: "#f59e0b", fillOpacity: 0.12 } }).addTo(map);
  overlay.bringToBack();
}

function zeichneUebersicht(m) {
  const codes = Object.keys(m).filter((c) => (segment === "besucht" ? warDort(m[c]) : m[c] === segment));
  const n = codes.filter((c) => UN_SET.has(c)).length, pz = Math.floor((n / UN.length) * 100);
  const label = segment === "wunsch" ? "Ländern auf der Wunschliste" : segment === "gelebt" ? "Ländern gelebt" : "Ländern bereist";
  $("#gesamt").innerHTML = `<div class="zahlen"><span class="gross">${n}</span><span>von ${UN.length} ${label}</span><span class="prozent">${pz} %</span></div>
    <div class="balken"><i style="width:${Math.max(1, (n / UN.length) * 100)}%;background:${LFARBE[segment]}"></i></div>
    <small>${segment === "wunsch" ? "" : `Noch ${UN.length - n} Länder offen`}${codes.length > n ? ` · +${codes.length - n} weitere Gebiete` : ""}</small>`;
  const gruppen = {};
  for (const c of codes) { const k = landInfo[c]?.k || "Sonstige"; (gruppen[k] ||= []).push(c); }
  const name = (c) => regionDE.of(c) || landInfo[c]?.de || c;
  $("#laender-liste").innerHTML = Object.keys(gruppen).sort((a, b) => KONT_REIHE.indexOf(a) - KONT_REIHE.indexOf(b)).map((k) =>
    `<h3>${k} (${gruppen[k].length})</h3>` + gruppen[k].sort((a, b) => name(a).localeCompare(name(b), "de")).map((c) => {
      const orteHier = orte.filter((o) => isoVonName(o.land) === c).length;
      return `<div class="item" onclick="landSheet('${c}')"><span class="flagge">${flagge(c)}</span><div><b>${esc(name(c))}</b>
        <small>${orteHier ? `${orteHier} Orte` : ""}</small></div>${UN_SET.has(c) ? `<span class="un">UN</span>` : ""}</div>`;
    }).join("")).join("") || `<p class="hint">Noch keine Länder. Tippe auf ein Land in der Karte oder auf „+ Land“.</p>`;
}

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
    ${s ? `<button onclick="setzeLand('${c}','keins')">Entfernen</button>` : ""}
    ${orteHier.length ? `<h3>Orte (${orteHier.length})</h3>` + orteHier.map((o) => `<div class="item" onclick="zeigeOrt('${o.id}')"><span class="dot" style="background:${FARBE[o.status]}"></span><div><b>${esc(o.name)}</b><small>${esc(o.status)}</small></div></div>`).join("") : ""}`);
}
$("#b-land-neu").onclick = () => {
  const alle = Object.keys(landInfo).map((c) => [c, regionDE.of(c) || landInfo[c].de]).sort((a, b) => a[1].localeCompare(b[1], "de"));
  oeffneSheet(`<div class="sheet-head"><h2>Land hinzufügen</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <input id="land-such" placeholder="Land suchen…" autocomplete="off"><div id="land-treffer"></div>`);
  const zeig = (q) => { $("#land-treffer").innerHTML = alle.filter(([, n]) => n.toLowerCase().includes(q.toLowerCase())).slice(0, 30)
    .map(([c, n]) => `<button class="treffer" onclick="landSheet('${c}')">${flagge(c)} ${esc(n)}</button>`).join(""); };
  $("#land-such").oninput = (e) => zeig(e.target.value); zeig(""); $("#land-such").focus();
};
document.querySelectorAll("#seg button").forEach((b) => (b.onclick = () => {
  segment = b.dataset.s; document.querySelectorAll("#seg button").forEach((x) => x.classList.toggle("on", x === b)); zeichneUebersicht(statusMap());
}));
// Karte neu einpassen, wenn der Tab sichtbar wird
new ResizeObserver(() => weltMap.invalidateSize()).observe($("#weltkarte"));

(async () => {
  welt = await fetch("welt.geojson").then((r) => r.json());
  for (const f of welt.features) landInfo[f.properties.iso] = f.properties;
  laenderDaten = await DB.all("laender");
  if (!laenderDaten.length) { for (const c of START_BEREIST) await DB.put("laender", { code: c, status: "besucht" }); laenderDaten = await DB.all("laender"); }
  zeichneLaender();
})();
