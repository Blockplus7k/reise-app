// Reise-App – Karte, Orte, Fotos, Reisen. Alle Daten bleiben lokal (IndexedDB).
const FARBE = { besucht: "#16a34a", geplant: "#2563eb", idee: "#f59e0b", verworfen: "#9ca3af" };
const STATUS = ["idee", "geplant", "besucht", "verworfen"];
const TYPEN = ["Architektur", "Monument", "Mosaik", "Seilbahn", "Lost Place", "Industrie", "Bahn", "Bushaltestelle", "Aussicht", "Viertel", "Unterkunft", "Essen", "Natur", "Stadt", "Sonstiges"];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let orte = [], reisen = [], aktiveReise = null;
const urls = []; // ObjectURLs für Fotos, beim Schließen freigeben

// ---------- Karte ----------
let landFilter = ""; // ISO2 des gewählten Landes ("" = alle)
const map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([35, 10], 2);
// Wie auf der Webseite: OpenStreetMap Deutschland – deutsche Länder- und Ortsnamen schon weit herausgezoomt
L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap-Mitwirkende" }).addTo(map);
const cluster = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 9, showCoverageOnHover: false }).addTo(map);
const routeLayer = L.layerGroup().addTo(map);

const PINFARBE = { ...FARBE, besucht: "#567c8d" };
function pin(o) {
  return L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 30],
    html: `<div class="pin" data-pin="${o.id}" style="background:${PINFARBE[o.status] || "#888"}"></div>` });
}
const LAENDER_GESAMT = 195; // 193 UN-Staaten + Vatikan + Palästina
function zeichneLaender() {
  const besucht = [...new Set(orte.filter((o) => o.status === "besucht").map((o) => o.land).filter(Boolean))].sort();
  const wunsch = [...new Set(orte.filter((o) => o.status === "idee" || o.status === "geplant").map((o) => o.land).filter((l) => l && !besucht.includes(l)))];
  const n = besucht.length, pz = ((n / LAENDER_GESAMT) * 100).toFixed(1).replace(".", ",");
  $("#laender").innerHTML = `<div class="zahlen"><span class="gross">${n}</span><span>von ${LAENDER_GESAMT} Ländern bereist</span><span class="prozent">${pz} %</span></div>
    <div class="balken"><i style="width:${Math.max(1, (n / LAENDER_GESAMT) * 100)}%"></i></div>
    <small>Noch ${LAENDER_GESAMT - n} Länder offen${wunsch.length ? ` · ${wunsch.length} davon auf der Wunschliste` : ""}</small>`;
  $("#laender").onclick = () => alert(`Bereist (${n}):\n${besucht.join(", ")}` + (wunsch.length ? `\n\nWunschliste:\n${wunsch.join(", ")}` : ""));
}
const markerVon = {};
// Leiste unter der Karte: zuerst Reise-Ordner (alle Fotos einer Reise), dann die Orte
let leisteUrls = [];
function reiseFotos(r, alle) { return alle.filter((f) => f.reiseId === r.id || (f.ortId && r.tage.some((t) => t.orte.includes(f.ortId)))); }
function zeichneLeiste(liste) {
  const rs = reisen.filter((r) => !landFilter || r.land === landFilter).sort((a, b) => (b.von || "").localeCompare(a.von || ""));
  $("#leiste").innerHTML = rs.map((r) => `<li data-r="${r.id}" class="ordner"><a href="#" onclick="return zeigeOrdner('${r.id}')">
      <span class="leer" data-rbild="${r.id}">${r.land ? flagge(r.land) : "🧳"}</span><span><strong>📁 ${esc(r.titel)}</strong>
      <small data-ranz="${r.id}">${esc((r.von || "").slice(0, 4))} · Reise</small></span></a></li>`).join("") +
    liste.filter((o) => o.webFotos?.length).map((o) => {
    const bild = o.webFotos?.[0] ? `<img src="${o.webFotos[0]}-klein.webp" loading="lazy" alt="">` : `<span class="leer">📍</span>`;
    const n = (o.webFotos || []).length;
    return `<li data-o="${o.id}"><a href="#" onclick="return waehle('${o.id}')">${bild}<span><strong>${esc(o.name)}</strong>
      <small>${esc(o.land && o.land !== o.name ? o.land : o.typ || "")}${n ? ` · ${n} Fotos` : ""}</small></span></a></li>`;
  }).join("");
  fuelleOrdner(rs);
}
// Jede Reise als Ordner-Pin auf der Weltkarte: Mitte der Foto-Standorte, sonst Mitte des Landes
const reiseLayer = L.layerGroup().addTo(map);
const reiseOrteLayer = L.layerGroup().addTo(map);
let reiseFotoCache = {};
// Pin-Position: ein echter Foto-Standort (der „mittigste“, bevorzugt im Reiseland) – liegt so nie im Meer
function reisePosition(r, alle) {
  let pts = reiseFotos(r, alle).filter((f) => f.lat != null && f.lon != null).map((f) => [f.lat, f.lon]);
  for (const oid of r.tage.flatMap((t) => t.orte)) { const o = orte.find((x) => x.id === oid); if (o) pts.push([o.lat, o.lon]); }
  if (r.land && typeof landFuerPunkt === "function") { const imLand = pts.filter((p) => landFuerPunkt(p[0], p[1]) === r.land); if (imLand.length) pts = imLand; }
  if (pts.length) {
    const m = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    return pts.reduce((best, p) => (distKm(p[0], p[1], m[0], m[1]) < distKm(best[0], best[1], m[0], m[1]) ? p : best));
  }
  if (r.land && typeof landInfo !== "undefined" && landInfo[r.land]) return [landInfo[r.land].ly, landInfo[r.land].lx];
  return null;
}
function zeichneReisePins(rs, alle) {
  reiseLayer.clearLayers(); reiseFotoCache = {};
  for (const r of rs) {
    reiseFotoCache[r.id] = reiseFotos(r, alle);
    const pos = reisePosition(r, alle); if (!pos) continue;
    L.marker(pos, { zIndexOffset: 1000, title: r.titel, icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 30],
      html: `<div class="pin reise" data-reise="${r.id}"><b>📁</b></div><span class="pin-name">${esc(r.titel)}</span>` }) })
      .on("click", () => reiseMenue(r.id)).addTo(reiseLayer);
  }
}
// Fotos mit Standort zu Orten bündeln (alles innerhalb ~1,5 km = ein Ort)
function fotoGruppen(fs) {
  const gruppen = [];
  for (const f of fs.filter((x) => x.lat != null).sort((a, b) => (a.datum || "").localeCompare(b.datum || ""))) {
    const g = gruppen.find((g) => distKm(g.lat, g.lon, f.lat, f.lon) < 1.5);
    if (g) { g.fotos.push(f); g.lat = (g.lat * (g.fotos.length - 1) + f.lat) / g.fotos.length; g.lon = (g.lon * (g.fotos.length - 1) + f.lon) / g.fotos.length; }
    else gruppen.push({ lat: f.lat, lon: f.lon, fotos: [f] });
  }
  return gruppen;
}
async function reiseMenue(id) {
  const r = reisen.find((x) => x.id === id); if (!r) return;
  const fs = reiseFotoCache[id] || reiseFotos(r, await DB.all("fotos"));
  const gruppen = fotoGruppen(fs), ohne = fs.filter((f) => f.lat == null).length;
  oeffneSheet(`<div class="sheet-head"><h2>📁 ${esc(r.titel)}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta">${r.land ? flagge(r.land) + " " + esc(landName(r.land)) + " · " : ""}${esc(r.von || "")} – ${esc(r.bis || "")}</p>
    <div class="wahlknoepfe">
      <button onclick="zeigeOrdner('${id}')"><span>🖼️</span><b>Alle Fotos</b><small>${fs.length} Fotos</small></button>
      <button onclick="zeigeReiseOrte('${id}')" ${gruppen.length ? "" : "disabled"}><span>📍</span><b>Nach Orten</b><small>${gruppen.length} Orte auf der Karte${ohne ? ` · ${ohne} ohne Standort` : ""}</small></button>
    </div>
    <div class="row"><button onclick="zeigeReise('${id}')">Reise-Details & Antworten</button></div>`);
}
// Orts-Pins einer Reise – erst sichtbar, nachdem man den Reise-Pin geöffnet hat
const ortNamen = {};
async function zeigeReiseOrte(id) {
  const r = reisen.find((x) => x.id === id); if (!r) return;
  const gruppen = fotoGruppen(reiseFotoCache[id] || reiseFotos(r, await DB.all("fotos")));
  schliesseSheet(); reiseOrteAus(); $("#trip-banner").hidden = true;
  gruppen.forEach((g, i) => {
    const u = URL.createObjectURL(g.fotos[0].thumb); pinUrls.push(u);
    L.marker([g.lat, g.lon], { zIndexOffset: 2000, icon: L.divIcon({ className: "", iconSize: [46, 46], iconAnchor: [23, 23],
      html: `<div class="foto-pin"><img src="${u}" alt=""><i>${g.fotos.length}</i></div>` }) })
      .on("click", () => zeigeFotoGruppe(id, i)).addTo(reiseOrteLayer);
  });
  reiseOrteLayer.gruppen = gruppen; reiseOrteLayer.reise = id;
  $("#trip-banner").innerHTML = `📁 ${esc(r.titel)} · ${gruppen.length} Orte <button onclick="reiseOrteAus()">✕</button>`; $("#trip-banner").hidden = false;
  if (gruppen.length) map.fitBounds(gruppen.map((g) => [g.lat, g.lon]), { padding: [50, 50], maxZoom: 13 });
}
let pinUrls = [];
function reiseOrteAus() { reiseOrteLayer.clearLayers(); pinUrls.forEach(URL.revokeObjectURL); pinUrls = []; $("#trip-banner").hidden = true; }
async function zeigeFotoGruppe(id, i) {
  const g = reiseOrteLayer.gruppen?.[i]; if (!g) return;
  const key = g.lat.toFixed(3) + "," + g.lon.toFixed(3);
  const bekannt = orte.find((o) => distKm(o.lat, o.lon, g.lat, g.lon) < 1);
  const html = g.fotos.map((f) => { const u = URL.createObjectURL(f.thumb); urls.push(u); return `<img src="${u}" data-f="${f.id}" alt="">`; }).join("");
  const daten = [...new Set(g.fotos.map((f) => f.datum).filter(Boolean))];
  oeffneSheet(`<div class="sheet-head"><h2 id="gruppe-name">${esc(bekannt?.name || ortNamen[key] || "Ort " + (i + 1))}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta">${g.fotos.length} Fotos${daten.length ? " · " + esc(daten.join(", ")) : ""}</p>
    <div class="galerie" id="g-galerie">${html}</div>
    <div class="row"><button onclick="reiseMenue('${id}')">← Zur Reise</button><a class="btn" href="https://maps.apple.com/?ll=${g.lat},${g.lon}" target="_blank">Apple Karten</a></div>`);
  $("#g-galerie").onclick = (e) => { const f = g.fotos.find((x) => x.id === e.target.dataset.f); if (!f) return;
    const u = URL.createObjectURL(f.bild); urls.push(u); $("#viewer-img").src = u; $("#viewer").hidden = false; };
  // Ortsnamen einmalig über OpenStreetMap nachschlagen
  if (!bekannt && !ortNamen[key]) {
    const d = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&accept-language=de&lat=${g.lat}&lon=${g.lon}`).then((r) => r.json()).catch(() => null);
    const a = d?.address || {}; const n = a.village || a.town || a.city || a.suburb || a.municipality || a.county || d?.name;
    if (n) { ortNamen[key] = n; const h = $("#gruppe-name"); if (h) h.textContent = n; }
  }
}
async function fuelleOrdner(rs) {
  leisteUrls.forEach(URL.revokeObjectURL); leisteUrls = [];
  const alle = await DB.all("fotos");
  zeichneReisePins(rs, alle);
  for (const r of rs) {
    const fs = reiseFotos(r, alle);
    const anz = document.querySelector(`[data-ranz="${r.id}"]`); if (anz) anz.textContent = `${(r.von || "").slice(0, 4)} · ${fs.length} Fotos`;
    const platz = document.querySelector(`[data-rbild="${r.id}"]`);
    if (platz && fs[0]) { const u = URL.createObjectURL(fs[0].thumb); leisteUrls.push(u); platz.outerHTML = `<img src="${u}" alt="">`; }
  }
}
async function raeumeFotoOrteAuf() {
  let n = 0;
  for (const o of orte.filter((x) => /^Foto-Ort/.test(x.name))) {
    const fs = await DB.byOrt(o.id);
    if (fs.length && !fs.every((f) => f.reiseId)) continue; // per 📷-Knopf importiert → bleibt
    for (const f of fs) { f.ortId = null; f.lat ??= o.lat; f.lon ??= o.lon; await DB.put("fotos", f); }
    for (const r of reisen) if (r.tage.some((t) => t.orte.includes(o.id))) { r.tage.forEach((t) => (t.orte = t.orte.filter((x) => x !== o.id))); await DB.put("reisen", r); }
    await DB.del("orte", o.id); n++;
  }
  if (n) await lade();
}
// Ordner-Ansicht: alle Fotos der Reise (direkt zur Reise hinzugefügt + von Orten der Reise)
async function zeigeOrdner(id) {
  const r = reisen.find((x) => x.id === id); if (!r) return false;
  const fs = reiseFotos(r, await DB.all("fotos")).sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
  if (r.land && typeof zeigeLandAufKarte === "function") zeigeLandAufKarte(r.land);
  document.querySelectorAll(".leiste li.aktiv").forEach((e) => e.classList.remove("aktiv"));
  document.querySelector(`.leiste li[data-r="${id}"]`)?.classList.add("aktiv");
  const html = fs.map((f) => { const u = URL.createObjectURL(f.thumb); urls.push(u); return `<img src="${u}" data-f="${f.id}" alt="">`; }).join("");
  oeffneSheet(`<div class="sheet-head"><h2>📁 ${esc(r.titel)}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta">${r.land ? flagge(r.land) + " " + esc(landName(r.land)) + " · " : ""}${esc(r.von)} – ${esc(r.bis)} · ${fs.length} Fotos</p>
    <div class="galerie" id="o-galerie">${html || ""}</div>${fs.length ? "" : `<p class="hint">Noch keine Fotos in dieser Reise.</p>`}
    <label class="btn">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden id="in-ordnerfotos"></label>
    <div class="row"><button onclick="zeigeReise('${id}')">Reise-Details & Antworten</button></div>`);
  $("#in-ordnerfotos").onchange = async (e) => { const files = [...e.target.files]; e.target.value = ""; await importiereFotos(files, id); zeigeOrdner(id); };
  $("#o-galerie").onclick = (e) => { const f = fs.find((x) => x.id === e.target.dataset.f); if (!f) return;
    const u = URL.createObjectURL(f.bild); urls.push(u); $("#viewer-img").src = u; $("#viewer").hidden = false; };
  return false;
}
function markiere(id) {
  document.querySelectorAll(".leiste li.aktiv, .pin.aktiv").forEach((e) => e.classList.remove("aktiv"));
  const li = document.querySelector(`.leiste li[data-o="${CSS.escape(id)}"]`);
  if (li) { li.classList.add("aktiv"); li.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }); }
  document.querySelector(`.pin[data-pin="${CSS.escape(id)}"]`)?.classList.add("aktiv");
}
function waehle(id) {
  const o = orte.find((x) => x.id === id);
  // Zweites Antippen derselben Karte öffnet den Ort
  if (document.querySelector(`.leiste li.aktiv[data-o="${CSS.escape(id)}"]`)) { zeigeOrt(id); return false; }
  map.flyTo([o.lat, o.lon], o.typ === "Land" ? 5 : Math.max(map.getZoom(), 7), { duration: 0.8 });
  map.once("moveend", () => markiere(id));
  markiere(id);
  return false;
}

function zeichneKarte() {
  cluster.clearLayers();
  const fs = $("#f-status").value, fl = landFilter;
  const sicht = orte.filter((o) => (!fs || o.status === fs) && (!fl || isoVonName(o.land) === fl))
    .sort((a, b) => (a.status === "besucht" ? 0 : 1) - (b.status === "besucht" ? 0 : 1) || a.land.localeCompare(b.land) || a.name.localeCompare(b.name));
  for (const k in markerVon) delete markerVon[k];
  for (const o of sicht) {
    markerVon[o.id] = L.marker([o.lat, o.lon], { icon: pin(o), title: o.name })
      .on("click", () => { markiere(o.id); zeigeOrt(o.id); }).addTo(cluster);
  }
  zeichneLeiste(sicht);
}
$("#f-status").onchange = zeichneKarte;

// Langes Drücken / Rechtsklick = neuer Ort
map.on("contextmenu", (e) => bearbeiteOrt({ lat: e.latlng.lat, lon: e.latlng.lng }));
$("#b-hier").onclick = () => {
  navigator.geolocation.getCurrentPosition(
    (p) => { map.setView([p.coords.latitude, p.coords.longitude], 14);
      if (confirm("Aktuellen Standort als Ort speichern?")) bearbeiteOrt({ lat: p.coords.latitude, lon: p.coords.longitude, status: "besucht" }); },
    () => alert("Standort nicht verfügbar"));
};

// ---------- Sheet (Detail/Formulare) ----------
function oeffneSheet(html) { $("#sheet-inner").innerHTML = html; $("#sheet").hidden = false; }
function schliesseSheet() { $("#sheet").hidden = true; urls.splice(0).forEach(URL.revokeObjectURL); }
$("#sheet").onclick = (e) => { if (e.target.id === "sheet") schliesseSheet(); };
$("#viewer").onclick = () => { $("#viewer").hidden = true; };

async function zeigeOrt(id) {
  const o = orte.find((x) => x.id === id); if (!o) return;
  const fotos = await DB.byOrt(id);
  const fotoHtml = fotos.map((f) => { const u = URL.createObjectURL(f.thumb); urls.push(u);
    return `<img src="${u}" data-f="${f.id}" alt="">`; }).join("")
    + (o.webFotos || []).map((p) => `<img src="${p}-klein.webp" data-w="${p}" loading="lazy" alt="">`).join("");
  const anzahl = fotos.length + (o.webFotos || []).length;
  const inReisen = reisen.filter((r) => r.tage.some((t) => t.orte.includes(id))).map((r) => esc(r.titel)).join(", ");
  oeffneSheet(`
    <div class="sheet-head"><h2>${esc(o.name)}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta"><span class="badge" style="background:${FARBE[o.status]}">${esc(o.status)}</span>
      ${esc(o.typ)} · ${esc([o.region, o.land].filter(Boolean).join(", "))} · Prio ${o.prio}</p>
    ${o.notiz ? `<p>${esc(o.notiz)}</p>` : ""}
    ${o.besuchtAm ? `<p class="meta">Besucht am ${esc(o.besuchtAm)}</p>` : ""}
    ${inReisen ? `<p class="meta">In Reise: ${inReisen}</p>` : ""}
    <div class="row">
      ${o.link ? `<a class="btn" href="${esc(o.link)}" target="_blank" rel="noopener">${/youtu|instagram|tiktok/.test(o.link) ? "▶︎ Video" : "🌐 Webseite"}</a>` : ""}
      <a class="btn" href="https://maps.apple.com/?ll=${o.lat},${o.lon}&q=${encodeURIComponent(o.name)}" target="_blank">Apple Karten</a>
      <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lon}" target="_blank">Google Maps</a>
    </div>
    <h3>Fotos (${anzahl})</h3>
    <div class="galerie" id="galerie">${fotoHtml}</div>
    <label class="btn">+ Fotos hinzufügen<input type="file" accept="image/*" multiple hidden id="in-ortfotos"></label>
    <div class="row">
      <button onclick="bearbeiteOrt(orte.find(x=>x.id==='${o.id}'))">Bearbeiten</button>
      ${o.status !== "besucht" ? `<button onclick="markiereBesucht('${o.id}')">✓ Besucht</button>` : ""}
      <button onclick="zuReise('${o.id}')">Zu Reise…</button>
    </div>`);
  $("#in-ortfotos").onchange = async (e) => { await fotosZuOrt(id, e.target.files); zeigeOrt(id); };
  $("#galerie").onclick = async (e) => {
    if (e.target.dataset.w) { $("#viewer-img").src = e.target.dataset.w + "-gross.webp"; $("#viewer").hidden = false; return; }
    const fid = e.target.dataset.f; if (!fid) return;
    const f = fotos.find((x) => x.id === fid);
    const u = URL.createObjectURL(f.bild); urls.push(u);
    $("#viewer-img").src = u; $("#viewer").hidden = false;
  };
  $("#galerie").oncontextmenu = async (e) => {
    const fid = e.target.dataset.f; if (!fid) return; e.preventDefault();
    if (confirm("Foto aus der App entfernen? (Original in deiner Mediathek bleibt)")) { await DB.del("fotos", fid); zeigeOrt(id); }
  };
}

function bearbeiteOrt(o) {
  const neu = !o.id;
  o = { status: "idee", prio: 2, typ: "", land: landFilter ? regionDE.of(landFilter) : "", region: "", notiz: "", link: "", name: "", ...o };
  oeffneSheet(`
    <div class="sheet-head"><h2>${neu ? "Neuer Ort" : "Ort bearbeiten"}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <form id="f-ort">
      <label>Name<input name="name" required value="${esc(o.name)}"></label>
      ${neu ? `<label>Suchen (OpenStreetMap)<div class="row"><input id="such" placeholder="z. B. Chiatura Seilbahn"><button type="button" id="b-such">Suchen</button></div></label><div id="such-erg"></div>` : ""}
      <div class="row"><label>Land<input name="land" value="${esc(o.land)}"></label><label>Region<input name="region" value="${esc(o.region)}"></label></div>
      <div class="row">
        <label>Status<select name="status">${STATUS.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label>Prio<select name="prio">${[1, 2, 3].map((p) => `<option ${p == o.prio ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      </div>
      <label>Typ<input name="typ" list="typen" value="${esc(o.typ)}"><datalist id="typen">${TYPEN.map((t) => `<option>${t}</option>`).join("")}</datalist></label>
      <div class="row"><label>Lat<input name="lat" type="number" step="any" required value="${o.lat ?? ""}"></label><label>Lon<input name="lon" type="number" step="any" required value="${o.lon ?? ""}"></label></div>
      <label>Besucht am<input name="besuchtAm" type="date" value="${esc(o.besuchtAm || "")}"></label>
      <label>Link (Video etc.)<input name="link" value="${esc(o.link)}"></label>
      <label>Notiz<textarea name="notiz" rows="3">${esc(o.notiz)}</textarea></label>
      <div class="row"><button type="submit">Speichern</button>${neu ? "" : `<button type="button" class="danger" id="b-del">Löschen</button>`}</div>
    </form>`);
  if (neu) $("#b-such").onclick = async () => {
    const q = $("#such").value.trim(); if (!q) return;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => []);
    $("#such-erg").innerHTML = r.map((x, i) => `<button type="button" class="treffer" data-i="${i}">${esc(x.display_name)}</button>`).join("") || "<p class='hint'>Nichts gefunden</p>";
    $("#such-erg").onclick = (e) => { const x = r[e.target.dataset.i]; if (!x) return; const f = $("#f-ort");
      f.lat.value = (+x.lat).toFixed(5); f.lon.value = (+x.lon).toFixed(5);
      if (!f.name.value) f.name.value = x.name || q; if (!f.land.value && x.address) f.land.value = x.address.country || "";
      $("#such-erg").innerHTML = ""; };
  };
  $("#f-ort").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const rec = { ...o, ...d, lat: +d.lat, lon: +d.lon, prio: +d.prio, id: o.id || uid() };
    await DB.put("orte", rec); await lade(); zeigeOrt(rec.id);
  };
  if (!neu) $("#b-del").onclick = async () => {
    if (!confirm(`„${o.name}“ und seine Fotos löschen?`)) return;
    for (const f of await DB.byOrt(o.id)) await DB.del("fotos", f.id);
    await DB.del("orte", o.id);
    for (const r of reisen) { r.tage.forEach((t) => (t.orte = t.orte.filter((x) => x !== o.id))); await DB.put("reisen", r); }
    schliesseSheet(); lade();
  };
}

async function markiereBesucht(id) {
  const o = orte.find((x) => x.id === id);
  o.status = "besucht"; o.besuchtAm = o.besuchtAm || new Date().toISOString().slice(0, 10);
  await DB.put("orte", o); await lade(); zeigeOrt(id);
}

// ---------- Fotos ----------
async function verkleinere(file, max) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
}
async function leseFoto(file) {
  let gps = null, datum = null;
  try { gps = await exifr.gps(file); } catch {}
  try { const m = await exifr.parse(file, ["DateTimeOriginal"]); datum = m?.DateTimeOriginal ? new Date(m.DateTimeOriginal).toISOString().slice(0, 10) : null; } catch {}
  return { gps: gps && isFinite(gps.latitude) ? gps : null, datum, bild: await verkleinere(file, 1600), thumb: await verkleinere(file, 300) };
}
async function fotosZuOrt(ortId, files) {
  for (const file of files) { const f = await leseFoto(file); await DB.put("fotos", { id: uid(), ortId, datum: f.datum, bild: f.bild, thumb: f.thumb }); }
}
function distKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Globaler Import: Foto per GPS dem nächsten Ort (≤ 1 km) zuordnen, sonst neuen besuchten Ort anlegen
$("#b-fotoimport").onclick = () => $("#in-fotos").click();
// Fotos importieren: per GPS dem nächsten Ort (≤ 1 km) zuordnen, sonst neuen besuchten Ort anlegen.
// Mit reiseId werden die Fotos zusätzlich der Reise zugeordnet (auch ohne GPS).
async function importiereFotos(files, reiseId) {
  let zu = 0, neu = 0, ohne = 0;
  for (const file of files) {
    const f = await leseFoto(file);
    let best = null;
    // Fotos einer Reise legen keine neuen „Foto-Orte“ an – sie gehören in den Reise-Ordner
    if (f.gps && reiseId) {
      const { latitude: la, longitude: lo } = f.gps; let bd = 1;
      for (const o of orte) { const d = distKm(la, lo, o.lat, o.lon); if (d < bd) { bd = d; best = o; } }
      if (best) zu++;
    } else if (f.gps) {
      const { latitude: la, longitude: lo } = f.gps; let bd = 1;
      for (const o of orte) { const d = distKm(la, lo, o.lat, o.lon); if (d < bd) { bd = d; best = o; } }
      if (!best) {
        best = { id: uid(), name: `Foto-Ort ${f.datum || ""}`.trim(), lat: la, lon: lo, status: "besucht", prio: 2, typ: "", land: "", region: "", notiz: "", link: "", besuchtAm: f.datum || "" };
        orte.push(best); neu++;
      } else zu++;
      if (best.status !== "besucht") { best.status = "besucht"; best.besuchtAm = best.besuchtAm || f.datum || ""; }
      await DB.put("orte", best);
    } else ohne++;
    if (best || reiseId) await DB.put("fotos", { id: uid(), ortId: best?.id || null, reiseId: reiseId || null, datum: f.datum, lat: f.gps?.latitude ?? null, lon: f.gps?.longitude ?? null, bild: f.bild, thumb: f.thumb });
  }
  await lade();
  if (typeof laenderAusFotos === "function") await laenderAusFotos();
  return { zu, neu, ohne };
}
$("#in-fotos").onchange = async (e) => {
  const files = [...e.target.files]; e.target.value = "";
  const { zu, neu, ohne } = await importiereFotos(files);
  alert(`${zu} Fotos bestehenden Orten zugeordnet, ${neu} neue Orte angelegt` + (ohne ? `, ${ohne} ohne GPS übersprungen (im Ort über „+ Fotos“ hinzufügen)` : ""));
};


// ---------- Wunschliste ----------
// Wunschliste: nur Orte mit Status idee/geplant. „Geplant“ = Status geplant oder in einer Reise eingetragen.
let wunschFilter = "alle";
const istGeplant = (o) => o.status === "geplant" || reisen.some((r) => r.tage.some((t) => t.orte.includes(o.id)));
function zeichneWunsch() {
  const alle = orte.filter((o) => o.status === "idee" || o.status === "geplant");
  const nG = alle.filter(istGeplant).length;
  const knoepfe = { alle: `Alle (${alle.length})`, offen: `Noch nicht geplant (${alle.length - nG})`, geplant: `Geplant (${nG})` };
  document.querySelectorAll("#wseg button").forEach((b) => { b.textContent = knoepfe[b.dataset.w]; b.classList.toggle("on", b.dataset.w === wunschFilter); });
  const w = alle.filter((o) => wunschFilter === "alle" || (wunschFilter === "geplant") === istGeplant(o))
    .sort((a, b) => a.land.localeCompare(b.land) || a.prio - b.prio || a.name.localeCompare(b.name));
  let land = null, h = "";
  for (const o of w) {
    if (o.land !== land) { land = o.land; h += `<h3>${esc(land || "Ohne Land")}</h3>`; }
    const g = istGeplant(o);
    const reise = reisen.find((r) => r.tage.some((t) => t.orte.includes(o.id)));
    h += `<div class="item" onclick="zeigeOrt('${o.id}')"><span class="dot" style="background:${g ? FARBE.geplant : FARBE.idee}"></span>
      <div><b>${esc(o.name)}</b><small>${esc([o.typ, o.region, "Prio " + o.prio].filter(Boolean).join(" · "))}${reise ? ` · 🧳 ${esc(reise.titel)}` : ""}</small></div>
      <span class="tag-status ${g ? "g" : ""}">${g ? "geplant" : "offen"}</span></div>`;
  }
  $("#wunsch-liste").innerHTML = h || `<p class='hint'>${wunschFilter === "geplant" ? "Noch nichts geplant – füge Wunschorte einer Reise hinzu." : "Keine Wunschorte."}</p>`;
}
document.querySelectorAll("#wseg button").forEach((b) => (b.onclick = () => { wunschFilter = b.dataset.w; zeichneWunsch(); }));

// ---------- Reisen ----------
function tageZwischen(von, bis) {
  const t = [], d = new Date(von), e = new Date(bis);
  while (d <= e && t.length < 120) { t.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return t;
}
function zeichneReisen() {
  $("#reise-liste").innerHTML = reisen.sort((a, b) => (b.von || "").localeCompare(a.von || "")).map((r) => {
    const n = r.tage.reduce((s, t) => s + t.orte.length, 0);
    return `<div class="item" onclick="zeigeReise('${r.id}')"><span>🧳</span><div><b>${esc(r.titel)}</b><small>${esc(r.von)} – ${esc(r.bis)} · ${n} Orte</small></div></div>`;
  }).join("") || "<p class='hint'>Noch keine Reise. Lege eine an und füge Wunschorte zu den Tagen hinzu.</p>";
}
$("#b-neue-reise").onclick = () => bearbeiteReise({});
const FRAGEN = [
  ["highlight", "Was war dein Highlight?", "Der eine Moment, an den du zuerst denkst"],
  ["begegnung", "Beste Begegnung?", "Ein Mensch, ein Gespräch, ein Tier …"],
  ["essen", "Bestes Essen oder Getränk?", ""],
  ["ueberraschung", "Was hat dich überrascht?", ""],
  ["ort", "Lieblingsort der Reise?", ""],
  ["anders", "Was würdest du nächstes Mal anders machen?", ""],
  ["satz", "Die Reise in einem Satz", ""],
];
function bearbeiteReise(r) {
  const heute = new Date().toISOString().slice(0, 10);
  const laenderListe = Object.keys(landInfo).map((c) => [c, landName(c)]).sort((a, b) => a[1].localeCompare(b[1], "de"));
  const fr = r.fragen || {};
  oeffneSheet(`
    <div class="sheet-head"><h2>${r.id ? "Reise bearbeiten" : "Neue Reise"}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <form id="f-reise">
      <label>Wohin?<input id="r-land-such" placeholder="Land suchen, z. B. Isl…" autocomplete="off" value="${r.land ? esc(flagge(r.land) + " " + landName(r.land)) : ""}"></label>
      <input type="hidden" name="land" value="${esc(r.land || "")}"><div id="r-land-treffer"></div>
      <label>Titel<input name="titel" value="${esc(r.titel || "")}" placeholder="z. B. Island Roadtrip"></label>
      <p class="frage">Wann war die Reise?</p>
      <div class="row"><label>Von<input type="date" name="von" required value="${esc(r.von || "")}"></label><label>Bis<input type="date" name="bis" required value="${esc(r.bis || "")}"></label></div>
      <div id="erinnerung">
        <p class="frage">Erzähl mal 🙂</p>
        ${FRAGEN.map(([k, t, h]) => `<label>${t}<textarea name="f_${k}" rows="2" placeholder="${esc(h)}">${esc(fr[k] || "")}</textarea></label>`).join("")}
        <label>Wie war die Reise insgesamt?<div class="sterne" id="sterne">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${n <= (r.sterne || 0) ? "an" : ""}">★</button>`).join("")}</div></label>
      </div>
      <label>Notiz<textarea name="notiz" rows="2">${esc(r.notiz || "")}</textarea></label>
      <label class="btn fotoknopf">📷 Fotos hinzufügen<input type="file" name="fotos" accept="image/*" multiple hidden></label>
      <p class="hint" id="foto-info">Fotos mit GPS landen automatisch beim passenden Ort auf der Karte.</p>
      <div class="row"><button type="submit">Speichern</button>${r.id ? `<button type="button" class="danger" id="b-rdel">Löschen</button>` : ""}</div>
    </form>`);
  const f = $("#f-reise");
  let sterne = r.sterne || 0;
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  $("#r-land-such").onfocus = (e) => e.target.select();
  $("#r-land-such").oninput = (e) => {
    const q = norm(e.target.value.trim()); f.land.value = "";
    if (!q) return ($("#r-land-treffer").innerHTML = "");
    const m = statusMap();
    const treffer = laenderListe.filter(([c, n]) => norm(n).includes(q) || c.toLowerCase() === q)
      .sort((a, b) => norm(a[1]).startsWith(q) === norm(b[1]).startsWith(q) ? 0 : norm(a[1]).startsWith(q) ? -1 : 1).slice(0, 8);
    $("#r-land-treffer").innerHTML = treffer.map(([c, n]) => `<button type="button" class="treffer" data-c="${c}">${flagge(c)} ${esc(n)}${m[c] ? ` <small>· ${LNAME[m[c]]}</small>` : ""}</button>`).join("") || "<p class='hint'>Kein Land gefunden</p>";
  };
  $("#r-land-treffer").onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return;
    f.land.value = b.dataset.c; $("#r-land-such").value = flagge(b.dataset.c) + " " + landName(b.dataset.c); $("#r-land-treffer").innerHTML = ""; };
  $("#sterne").onclick = (e) => { const n = +e.target.dataset.n; if (!n) return; sterne = n;
    $("#sterne").querySelectorAll("button").forEach((b) => b.classList.toggle("an", +b.dataset.n <= n)); };
  // Fragen nur bei Reisen, die schon begonnen haben
  const pruefe = () => { $("#erinnerung").hidden = !!f.von.value && f.von.value > heute; };
  f.von.onchange = () => { if (!f.bis.value || f.bis.value < f.von.value) f.bis.value = f.von.value; pruefe(); };
  pruefe();
  f.fotos.onchange = () => { $("#foto-info").textContent = `${f.fotos.files.length} Fotos ausgewählt – werden beim Speichern hinzugefügt.`; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)); const files = [...f.fotos.files];
    if (d.bis < d.von) return alert("Ende liegt vor Anfang");
    if (!r.id) {
      const gleich = reisen.find((x) => x.land && x.land === d.land && x.von === d.von);
      if (gleich) { if (confirm(`„${gleich.titel}“ mit diesem Land und Startdatum gibt es schon. Stattdessen diese Reise bearbeiten?`)) return bearbeiteReise(gleich); }
    }
    const fragen = {}; for (const [k] of FRAGEN) { if (d["f_" + k]?.trim()) fragen[k] = d["f_" + k].trim(); }
    const titel = d.titel.trim() || `${d.land ? landName(d.land) : "Reise"} ${d.von.slice(0, 4)}`;
    const alt = Object.fromEntries((r.tage || []).map((t) => [t.datum, t.orte]));
    const rec = { ...r, titel, land: d.land, von: d.von, bis: d.bis, notiz: d.notiz, fragen, sterne, id: r.id || uid(),
      tage: tageZwischen(d.von, d.bis).map((t) => ({ datum: t, orte: alt[t] || [] })) };
    await DB.put("reisen", rec);
    // Vergangene Reise → Land als bereist markieren, künftige → Wunsch
    if (d.land) { const st = statusMap()[d.land];
      if (d.von <= heute && !warDort(st)) await DB.put("laender", { code: d.land, status: "besucht" });
      else if (d.von > heute && !st) await DB.put("laender", { code: d.land, status: "wunsch" });
      laenderDaten = await DB.all("laender"); }
    if (files.length) { $("#foto-info").textContent = `Lade ${files.length} Fotos …`; await importiereFotos(files, rec.id); }
    await lade(); zeigeReise(rec.id);
  };
  if (r.id) $("#b-rdel").onclick = async () => { if (confirm("Reise löschen? Orte und Fotos bleiben erhalten.")) { await DB.del("reisen", r.id); schliesseSheet(); lade(); } };
}
async function zeigeReise(id) {
  const r = reisen.find((x) => x.id === id); if (!r) return;
  const rf = (await DB.all("fotos")).filter((f) => f.reiseId === id);
  const fotoHtml = rf.map((f) => { const u = URL.createObjectURL(f.thumb); urls.push(u); return `<img src="${u}" data-f="${f.id}" alt="">`; }).join("");
  const antworten = FRAGEN.filter(([k]) => r.fragen?.[k]).map(([k, t]) => `<div class="antwort"><small>${t}</small><p>${esc(r.fragen[k])}</p></div>`).join("");
  const name = (oid) => orte.find((o) => o.id === oid)?.name || "?";
  const wunsch = orte.filter((o) => o.status !== "verworfen").sort((a, b) => a.name.localeCompare(b.name));
  oeffneSheet(`
    <div class="sheet-head"><h2>${esc(r.titel)}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta">${r.land ? flagge(r.land) + " " + esc(landName(r.land)) + " · " : ""}${esc(r.von)} – ${esc(r.bis)}${r.sterne ? " · " + "★".repeat(r.sterne) : ""}</p>${r.notiz ? `<p>${esc(r.notiz)}</p>` : ""}
    ${antworten}
    <h3>Fotos (${rf.length})</h3><div class="galerie" id="r-galerie">${fotoHtml}</div>
    <label class="btn">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden id="in-reisefotos"></label>
    <div class="row"><button onclick="reiseAufKarte('${id}')">🗺️ Route auf Karte</button><button onclick="bearbeiteReise(reisen.find(x=>x.id==='${id}'))">Bearbeiten</button></div>
    ${r.tage.map((t, i) => `<div class="tag"><h3>Tag ${i + 1} · ${new Date(t.datum).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}</h3>
      ${t.orte.map((oid, j) => `<div class="stop"><span onclick="zeigeOrt('${oid}')">${j + 1}. ${esc(name(oid))}</span>
        <span><button class="mini" onclick="verschiebe('${id}',${i},${j},-1)">↑</button><button class="mini" onclick="verschiebe('${id}',${i},${j},1)">↓</button><button class="mini" onclick="entferne('${id}',${i},${j})">✕</button></span></div>`).join("")}
      <select onchange="fuegeHinzu('${id}',${i},this.value)"><option value="">+ Ort hinzufügen…</option>${wunsch.map((o) => `<option value="${o.id}">${esc(o.name)}${o.land ? " (" + esc(o.land) + ")" : ""}</option>`).join("")}</select></div>`).join("")}`);
  $("#in-reisefotos").onchange = async (e) => { const files = [...e.target.files]; e.target.value = ""; await importiereFotos(files, id); zeigeReise(id); };
  $("#r-galerie").onclick = (e) => { const f = rf.find((x) => x.id === e.target.dataset.f); if (!f) return;
    const u = URL.createObjectURL(f.bild); urls.push(u); $("#viewer-img").src = u; $("#viewer").hidden = false; };
}
async function speichereReise(r) { await DB.put("reisen", r); await lade(); zeigeReise(r.id); if (aktiveReise === r.id) reiseAufKarte(r.id, true); }
async function fuegeHinzu(rid, i, oid) {
  if (!oid) return; const r = reisen.find((x) => x.id === rid); r.tage[i].orte.push(oid);
  const o = orte.find((x) => x.id === oid); if (o.status === "idee") { o.status = "geplant"; await DB.put("orte", o); }
  speichereReise(r);
}
function verschiebe(rid, i, j, d) {
  const r = reisen.find((x) => x.id === rid), a = r.tage[i].orte, k = j + d;
  if (k < 0 || k >= a.length) return; [a[j], a[k]] = [a[k], a[j]]; speichereReise(r);
}
function entferne(rid, i, j) { const r = reisen.find((x) => x.id === rid); r.tage[i].orte.splice(j, 1); speichereReise(r); }
async function zuReise(oid) {
  if (!reisen.length) return alert("Lege zuerst unter „Reisen“ eine Reise an.");
  const liste = reisen.map((r, i) => `${i + 1}: ${r.titel}`).join("\n");
  const ri = +prompt(`Welche Reise?\n${liste}`) - 1; const r = reisen[ri]; if (!r) return;
  const ti = +prompt(`Welcher Tag? (1–${r.tage.length})`) - 1; if (!r.tage[ti]) return;
  await fuegeHinzu(r.id, ti, oid);
}
function reiseAufKarte(id, still) {
  const r = reisen.find((x) => x.id === id); routeLayer.clearLayers(); aktiveReise = id;
  const pts = [];
  r.tage.forEach((t, i) => t.orte.forEach((oid) => { const o = orte.find((x) => x.id === oid); if (!o) return;
    pts.push([o.lat, o.lon]);
    L.marker([o.lat, o.lon], { icon: L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="nr">${i + 1}</div>` }) })
      .on("click", () => zeigeOrt(o.id)).addTo(routeLayer); }));
  if (pts.length > 1) L.polyline(pts, { color: "#dc2626", weight: 3, dashArray: "6 6" }).addTo(routeLayer);
  $("#trip-banner").innerHTML = `🧳 ${esc(r.titel)} <button onclick="routeAus()">✕</button>`; $("#trip-banner").hidden = false;
  if (!still) { schliesseSheet(); wechsle("karte"); if (pts.length) map.fitBounds(pts, { padding: [50, 50] }); }
}
function routeAus() { routeLayer.clearLayers(); aktiveReise = null; $("#trip-banner").hidden = true; }

// ---------- Daten ----------
async function statistik() {
  const fotos = (await DB.all("fotos")).length;
  const b = orte.filter((o) => o.status === "besucht");
  $("#stats").innerHTML = `${orte.length} Orte · ${b.length} besucht · ${new Set(b.map((o) => o.land).filter(Boolean)).size} Länder besucht · ${reisen.length} Reisen · ${fotos} Fotos`;
}
$("#b-export").onclick = async () => {
  // Backup inkl. eigener Fotos (als Data-URLs), damit die Datei alles wiederherstellen kann
  const zuUrl = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  const fotos = [];
  for (const f of await DB.all("fotos")) { const { bild, thumb, ...rest } = f; fotos.push({ ...rest, bild: await zuUrl(bild), thumb: await zuUrl(thumb) }); }
  const blob = new Blob([JSON.stringify({ version: 3, exportiert: new Date().toISOString(), orte, reisen, laender: await DB.all("laender"), fotos })], { type: "application/json" });
  const file = new File([blob], `reisen-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
};

$("#in-import").onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  let d; try { d = JSON.parse(await file.text()); } catch { return alert("Keine gültige JSON-Datei"); }
  let n = 0, a = 0;
  for (const o of d.orte || []) {
    const alt = orte.find((x) => x.id === o.id);
    // Status/Besuch aus der App nicht mit "idee" aus dem Vault überschreiben
    const rec = alt ? { ...o, status: alt.status === "besucht" ? "besucht" : o.status, besuchtAm: alt.besuchtAm || o.besuchtAm } : o;
    await DB.put("orte", rec); alt ? a++ : n++;
  }
  for (const r of d.reisen || []) await DB.put("reisen", r);
  for (const l of d.laender || []) await DB.put("laender", l);
  let nf = 0;
  for (const f of d.fotos || []) { if (await DB.get("fotos", f.id)) continue;
    const zuBlob = (u) => fetch(u).then((r) => r.blob());
    await DB.put("fotos", { ...f, bild: await zuBlob(f.bild), thumb: await zuBlob(f.thumb) }); nf++; }
  if (d.laender) laenderDaten = await DB.all("laender");
  await lade(); alert(`${n} neue Orte, ${a} aktualisiert, ${(d.reisen || []).length} Reisen importiert` + (nf ? `, ${nf} Fotos wiederhergestellt` : "") + ".");
};

// ---------- Navigation & Start ----------
function wechsle(v) {
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "v-" + v));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  if (v === "karte") setTimeout(() => map.invalidateSize(), 50);
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => wechsle(b.dataset.v)));

async function lade() {
  orte = await DB.all("orte"); reisen = await DB.all("reisen");
  zeichneKarte(); zeichneLaender(); zeichneWunsch(); zeichneReisen(); statistik();
}
(async () => {
  await lade();
  // Mitgelieferte Orte (Vault-Export + Webseiten-Weltkarte) einmalig übernehmen; vorhandene nicht überschreiben
  for (const datei of ["orte.json", "web.json"]) {
    const d = await fetch(datei).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const o of d?.orte || []) {
      const alt = orte.find((x) => x.id === o.id);
      if (!alt) await DB.putRaw("orte", { ...o, geaendert: 0 });
      else if (o.webFotos && JSON.stringify(alt.webFotos) !== JSON.stringify(o.webFotos)) await DB.put("orte", { ...alt, webFotos: o.webFotos });
    }
  }
  await lade();
  await raeumeFotoOrteAuf();
  map.invalidateSize();
  new ResizeObserver(() => map.invalidateSize()).observe($("#map"));
  if (navigator.storage?.persist) navigator.storage.persist();
  // Neue Version automatisch laden: beim Öffnen nach Updates suchen, bei neuer Version einmal neu laden
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.register("sw.js");
    let neuGeladen = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!neuGeladen) { neuGeladen = true; location.reload(); } });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }
})();
// Reise-Namen an den Ordner-Pins erst ab Länder-Zoom zeigen (sonst überlappen sie in der Weltansicht)
const namenZoom = () => $("#map").classList.toggle("pins-klein", map.getZoom() < 5);
map.on("zoomend", namenZoom); namenZoom();
