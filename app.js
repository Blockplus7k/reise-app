// Reise-App – Karte, Orte, Fotos, Reisen. Alle Daten bleiben lokal (IndexedDB).
const FARBE = { besucht: "#16a34a", geplant: "#2563eb", idee: "#f59e0b", verworfen: "#9ca3af" };
const STATUS = ["idee", "geplant", "besucht", "verworfen"];
const TYPEN = ["Architektur", "Monument", "Mosaik", "Seilbahn", "Lost Place", "Industrie", "Bahn", "Bushaltestelle", "Aussicht", "Viertel", "Unterkunft", "Essen", "Natur", "Stadt", "Sonstiges"];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let orte = [], reisen = [], aktiveReise = null;
const urls = []; // ObjectURLs für Fotos, beim Schließen freigeben

// ---------- Karte ----------
const map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([40, 10], 3);
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
function zeichneLeiste(liste) {
  $("#leiste").innerHTML = liste.map((o) => {
    const bild = o.webFotos?.[0] ? `<img src="${o.webFotos[0]}-klein.webp" loading="lazy" alt="">` : `<span class="leer">📍</span>`;
    const n = (o.webFotos || []).length;
    return `<li data-o="${o.id}"><a href="#" onclick="return waehle('${o.id}')">${bild}<span><strong>${esc(o.name)}</strong>
      <small>${esc(o.land && o.land !== o.name ? o.land : o.typ || "")}${n ? ` · ${n} Fotos` : ""}</small></span></a></li>`;
  }).join("");
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
  const fs = $("#f-status").value, fl = $("#f-land").value;
  const sicht = orte.filter((o) => (!fs || o.status === fs) && (!fl || o.land === fl))
    .sort((a, b) => (a.status === "besucht" ? 0 : 1) - (b.status === "besucht" ? 0 : 1) || a.land.localeCompare(b.land) || a.name.localeCompare(b.name));
  for (const k in markerVon) delete markerVon[k];
  for (const o of sicht) {
    markerVon[o.id] = L.marker([o.lat, o.lon], { icon: pin(o), title: o.name })
      .on("click", () => { markiere(o.id); zeigeOrt(o.id); }).addTo(cluster);
  }
  zeichneLeiste(sicht);
  const laender = [...new Set(orte.map((o) => o.land).filter(Boolean))].sort();
  $("#f-land").innerHTML = `<option value="">Alle Länder</option>` + laender.map((l) => `<option ${l === fl ? "selected" : ""}>${esc(l)}</option>`).join("");
}
$("#f-status").onchange = zeichneKarte;
$("#f-land").onchange = () => {
  zeichneKarte();
  const pts = orte.filter((o) => o.land === $("#f-land").value).map((o) => [o.lat, o.lon]);
  if (pts.length) map.fitBounds(pts, { padding: [40, 40] });
};

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
  o = { status: "idee", prio: 2, typ: "", land: $("#f-land").value || "", region: "", notiz: "", link: "", name: "", ...o };
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
$("#in-fotos").onchange = async (e) => {
  const files = [...e.target.files]; e.target.value = "";
  let zu = 0, neu = 0, ohne = 0;
  for (const file of files) {
    const f = await leseFoto(file);
    if (!f.gps) { ohne++; continue; }
    const { latitude: la, longitude: lo } = f.gps;
    let best = null, bd = 1;
    for (const o of orte) { const d = distKm(la, lo, o.lat, o.lon); if (d < bd) { bd = d; best = o; } }
    if (!best) {
      best = { id: uid(), name: `Foto-Ort ${f.datum || ""}`.trim(), lat: la, lon: lo, status: "besucht", prio: 2, typ: "", land: "", region: "", notiz: "", link: "", besuchtAm: f.datum || "" };
      orte.push(best); neu++;
    } else zu++;
    if (best.status !== "besucht") { best.status = "besucht"; best.besuchtAm = best.besuchtAm || f.datum || ""; }
    await DB.put("orte", best);
    await DB.put("fotos", { id: uid(), ortId: best.id, datum: f.datum, bild: f.bild, thumb: f.thumb });
  }
  await lade();
  alert(`${zu} Fotos bestehenden Orten zugeordnet, ${neu} neue Orte angelegt` + (ohne ? `, ${ohne} ohne GPS übersprungen (im Ort über „+ Fotos“ hinzufügen)` : ""));
};

// ---------- Wunschliste ----------
function zeichneWunsch() {
  const w = orte.filter((o) => o.status === "idee" || o.status === "geplant").sort((a, b) => a.land.localeCompare(b.land) || a.prio - b.prio || a.name.localeCompare(b.name));
  let land = null, h = "";
  for (const o of w) {
    if (o.land !== land) { land = o.land; h += `<h3>${esc(land || "Ohne Land")}</h3>`; }
    h += `<div class="item" onclick="zeigeOrt('${o.id}')"><span class="dot" style="background:${FARBE[o.status]}"></span>
      <div><b>${esc(o.name)}</b><small>${esc(o.typ)} · ${esc(o.region)} · Prio ${o.prio}</small></div></div>`;
  }
  $("#wunsch-liste").innerHTML = h || "<p class='hint'>Noch keine Wunschorte.</p>";
}

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
function bearbeiteReise(r) {
  oeffneSheet(`
    <div class="sheet-head"><h2>${r.id ? "Reise bearbeiten" : "Neue Reise"}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <form id="f-reise">
      <label>Titel<input name="titel" required value="${esc(r.titel || "")}" placeholder="Georgien 2027"></label>
      <div class="row"><label>Von<input type="date" name="von" required value="${esc(r.von || "")}"></label><label>Bis<input type="date" name="bis" required value="${esc(r.bis || "")}"></label></div>
      <label>Notiz<textarea name="notiz" rows="3">${esc(r.notiz || "")}</textarea></label>
      <div class="row"><button type="submit">Speichern</button>${r.id ? `<button type="button" class="danger" id="b-rdel">Löschen</button>` : ""}</div>
    </form>`);
  $("#f-reise").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (d.bis < d.von) return alert("Ende liegt vor Anfang");
    const alt = Object.fromEntries((r.tage || []).map((t) => [t.datum, t.orte]));
    const rec = { ...r, ...d, id: r.id || uid(), tage: tageZwischen(d.von, d.bis).map((t) => ({ datum: t, orte: alt[t] || [] })) };
    await DB.put("reisen", rec); await lade(); zeigeReise(rec.id);
  };
  if (r.id) $("#b-rdel").onclick = async () => { if (confirm("Reise löschen? Orte bleiben erhalten.")) { await DB.del("reisen", r.id); schliesseSheet(); lade(); } };
}
function zeigeReise(id) {
  const r = reisen.find((x) => x.id === id); if (!r) return;
  const name = (oid) => orte.find((o) => o.id === oid)?.name || "?";
  const wunsch = orte.filter((o) => o.status !== "verworfen").sort((a, b) => a.name.localeCompare(b.name));
  oeffneSheet(`
    <div class="sheet-head"><h2>${esc(r.titel)}</h2><button class="x" onclick="schliesseSheet()">✕</button></div>
    <p class="meta">${esc(r.von)} – ${esc(r.bis)}</p>${r.notiz ? `<p>${esc(r.notiz)}</p>` : ""}
    <div class="row"><button onclick="reiseAufKarte('${id}')">🗺️ Route auf Karte</button><button onclick="bearbeiteReise(reisen.find(x=>x.id==='${id}'))">Bearbeiten</button></div>
    ${r.tage.map((t, i) => `<div class="tag"><h3>Tag ${i + 1} · ${new Date(t.datum).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}</h3>
      ${t.orte.map((oid, j) => `<div class="stop"><span onclick="zeigeOrt('${oid}')">${j + 1}. ${esc(name(oid))}</span>
        <span><button class="mini" onclick="verschiebe('${id}',${i},${j},-1)">↑</button><button class="mini" onclick="verschiebe('${id}',${i},${j},1)">↓</button><button class="mini" onclick="entferne('${id}',${i},${j})">✕</button></span></div>`).join("")}
      <select onchange="fuegeHinzu('${id}',${i},this.value)"><option value="">+ Ort hinzufügen…</option>${wunsch.map((o) => `<option value="${o.id}">${esc(o.name)}${o.land ? " (" + esc(o.land) + ")" : ""}</option>`).join("")}</select></div>`).join("")}`);
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
  const blob = new Blob([JSON.stringify({ version: 2, exportiert: new Date().toISOString(), orte, reisen, laender: await DB.all("laender") }, null, 1)], { type: "application/json" });
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
  if (d.laender) laenderDaten = await DB.all("laender");
  await lade(); alert(`${n} neue Orte, ${a} aktualisiert, ${(d.reisen || []).length} Reisen importiert.`);
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
      if (!alt) await DB.put("orte", o);
      else if (o.webFotos && JSON.stringify(alt.webFotos) !== JSON.stringify(o.webFotos)) await DB.put("orte", { ...alt, webFotos: o.webFotos });
    }
  }
  await lade();
  map.invalidateSize();
  const vb = orte.filter((o) => o.status === "besucht");
  if (vb.length) map.fitBounds(vb.map((o) => [o.lat, o.lon]), { padding: [30, 30], maxZoom: 5 });
  if (map.getZoom() < 3) map.setZoom(3);
  new ResizeObserver(() => map.invalidateSize()).observe($("#map"));
  if (navigator.storage?.persist) navigator.storage.persist();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
})();
