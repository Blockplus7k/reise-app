// Cloud-Sicherung in ein privates GitHub-Repo (Standard: Blockplus7k/reise-daten).
// Ablage im Repo: daten.json (Orte, Reisen, Länder, Foto-Liste, Löschungen) und fotos/<id>.jpg + fotos/<id>-t.jpg.
// Der Zugangsschlüssel (Token) bleibt nur auf diesem Gerät (localStorage).
const SYNC = {
  get repo() { return localStorage.getItem("syncRepo") || "Blockplus7k/reise-daten"; },
  get token() { return localStorage.getItem("syncToken") || ""; },
  laeuft: false, nochmal: false, timer: null, start: 0,
};
const STORES = ["orte", "reisen", "laender"];
const keyVon = (s, v) => (s === "laender" ? v.code : v.id);

function syncStatus(text, fehler) {
  const el = document.querySelector("#sync-status"); if (el) { el.textContent = text; el.classList.toggle("fehler", !!fehler); }
  const p = document.querySelector("#sync-punkt"); if (p) p.dataset.s = fehler ? "fehler" : SYNC.laeuft ? "laeuft" : "ok";
}
async function gh(pfad, { method = "GET", body, raw } = {}) {
  const r = await mitZeit(fetch(`https://api.github.com/repos/${SYNC.repo}/contents/${pfad}`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${SYNC.token}`, Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  }), 60000, "Verbindung zu GitHub");
  return r;
}
const mitZeit = (p, ms, was) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(was + " dauert zu lange")), ms))]);
const zuB64 = (blob) => mitZeit(new Promise((res, rej) => {
  if (!blob || !blob.size) return rej(new Error("Foto-Datei leer"));
  const f = new FileReader(); f.onload = () => res(String(f.result).split(",")[1]); f.onerror = () => rej(f.error || new Error("Foto nicht lesbar")); f.readAsDataURL(blob);
}), 20000, "Foto lesen");
const textB64 = (t) => zuB64(new Blob([t]));

async function ladeHoch(pfad, blob, nachricht) {
  const r = await gh(pfad, { method: "PUT", body: { message: nachricht, content: await zuB64(blob) } });
  if (r.ok || r.status === 422) return true; // 422 = existiert schon
  throw new Error(`Upload ${pfad}: ${r.status}`);
}

window.planeSync = () => {
  if (!SYNC.token) return;
  clearTimeout(SYNC.timer); SYNC.timer = setTimeout(sync, 4000);
  syncStatus("Änderungen werden gleich gesichert …");
};

async function sync() {
  if (!SYNC.token) return syncStatus("Nicht verbunden");
  if (!navigator.onLine) return syncStatus("Offline – wird gesichert, sobald du online bist");
  if (SYNC.laeuft && Date.now() - SYNC.start < 180000) { SYNC.nochmal = true; return syncStatus("Sicherung läuft gerade …"); }
  SYNC.laeuft = true; SYNC.start = Date.now(); syncStatus("Sichere …");
  try {
    // 1) Stand aus der Cloud holen
    let sha = null, fern = { orte: [], reisen: [], laender: [], fotos: [], geloescht: {} };
    const meta = await gh("daten.json");
    if (meta.status === 401 || meta.status === 403) throw new Error("Zugangsschlüssel ungültig oder ohne Rechte");
    if (meta.status === 404) { const repo = await fetch(`https://api.github.com/repos/${SYNC.repo}`, { headers: { Authorization: `Bearer ${SYNC.token}` } });
      if (!repo.ok) throw new Error(`Repo ${SYNC.repo} nicht erreichbar`); }
    if (meta.ok) { sha = (await meta.json()).sha; fern = { ...fern, ...(await (await gh("daten.json", { raw: true })).json()) }; }

    // 2) Löschungen zusammenführen und anwenden
    const lokalTomb = JSON.parse(localStorage.getItem("geloescht") || "{}");
    const tomb = { ...fern.geloescht };
    for (const k in lokalTomb) tomb[k] = Math.max(tomb[k] || 0, lokalTomb[k]);
    localStorage.setItem("geloescht", JSON.stringify(tomb));

    // 3) Datensätze abgleichen (neuere Änderung gewinnt)
    let geaendert = false;
    const stand = {};
    for (const s of STORES) {
      const lokal = Object.fromEntries((await DB.all(s)).map((v) => [keyVon(s, v), v]));
      for (const v of fern[s] || []) {
        const k = keyVon(s, v), l = lokal[k];
        if (tomb[s + ":" + k] >= (v.geaendert || 0)) continue;
        if (!l || (v.geaendert || 0) > (l.geaendert || 0)) { await DB.putRaw(s, v); lokal[k] = v; geaendert = true; }
      }
      for (const k in lokal) if (tomb[s + ":" + k] >= (lokal[k].geaendert || 0)) { await DB.delRaw(s, isNaN(k) ? k : k); delete lokal[k]; geaendert = true; }
      stand[s] = Object.values(lokal);
    }

    // 4) Fotos: fehlende herunterladen, neue hochladen, gelöschte entfernen
    const lokalFotos = Object.fromEntries((await DB.all("fotos")).map((f) => [f.id, f]));
    const fernFotos = Object.fromEntries((fern.fotos || []).map((f) => [f.id, f]));
    let runter = 0, hoch = 0, kaputt = 0;
    for (const id in fernFotos) {
      if (lokalFotos[id] || tomb["fotos:" + id]) continue;
      syncStatus(`Lade Fotos aus der Cloud … ${++runter}`);
      const [b, t] = await Promise.all([gh(`fotos/${id}.jpg`, { raw: true }), gh(`fotos/${id}-t.jpg`, { raw: true })]);
      if (!b.ok) continue;
      const bild = await b.blob(), thumb = t.ok ? await t.blob() : bild;
      const rec = { ...fernFotos[id], bild, thumb, sync: true };
      await DB.putRaw("fotos", rec); lokalFotos[id] = rec; geaendert = true;
    }
    for (const id in lokalFotos) {
      const f = lokalFotos[id];
      if (tomb["fotos:" + id]) { await DB.delRaw("fotos", id); delete lokalFotos[id]; continue; }
      if (f.sync && fernFotos[id] && (fernFotos[id].geaendert || 0) >= (f.geaendert || 0)) continue;
      if (!f.sync) {
        syncStatus(`Sichere Fotos … ${++hoch}`);
        try {
          await ladeHoch(`fotos/${id}.jpg`, f.bild, `Foto ${id}`);
          await ladeHoch(`fotos/${id}-t.jpg`, f.thumb, `Vorschau ${id}`);
          f.sync = true; await DB.putRaw("fotos", f);
        } catch (e) { if (/GitHub|Upload/.test(e.message)) throw e; kaputt++; } // Foto im Speicher defekt → überspringen
      }
    }
    // Dateien gelöschter Fotos im Repo entfernen (nur die, die dort noch gelistet sind)
    for (const id in fernFotos) {
      if (!tomb["fotos:" + id]) continue;
      for (const pfad of [`fotos/${id}.jpg`, `fotos/${id}-t.jpg`]) {
        const m = await gh(pfad); if (!m.ok) continue;
        await gh(pfad, { method: "DELETE", body: { message: `Foto ${id} gelöscht`, sha: (await m.json()).sha } });
      }
    }

    // 5) Neuen Stand schreiben
    const fotos = Object.values(lokalFotos).filter((f) => f.sync).map(({ bild, thumb, sync, ...rest }) => rest);
    const daten = { version: 1, stand: new Date().toISOString(), ...stand, fotos, geloescht: tomb };
    const neu = JSON.stringify(daten);
    if (neu !== JSON.stringify({ ...fern, stand: daten.stand })) {
      const r = await gh("daten.json", { method: "PUT", body: { message: `Sicherung ${daten.stand}`, content: await textB64(neu), ...(sha ? { sha } : {}) } });
      if (r.status === 409) SYNC.nochmal = true; // gleichzeitig geändert → gleich nochmal
      else if (!r.ok) throw new Error(`Speichern daten.json: ${r.status}`);
    }
    localStorage.setItem("syncZuletzt", new Date().toISOString());
    SYNC.laeuft = false;
    syncStatus(`Gesichert · ${new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · ${fotos.length} eigene Fotos in der Cloud${kaputt ? ` · ${kaputt} Fotos nicht lesbar (bitte neu hinzufügen)` : ""}`);
    if (geaendert) { laenderDaten = await DB.all("laender"); await lade(); }
  } catch (e) {
    SYNC.laeuft = false;
    syncStatus("Sicherung fehlgeschlagen: " + (e?.message || e), true);
  }
  if (SYNC.nochmal) { SYNC.nochmal = false; setTimeout(sync, 2000); }
}

// ---------- Einstellungen unter „Daten“ ----------
function zeichneSyncKarte() {
  const verbunden = !!SYNC.token;
  document.querySelector("#sync-karte").innerHTML = `
    <h3 style="margin-top:0">☁️ Automatische Sicherung <span id="sync-punkt" data-s="ok"></span></h3>
    <p class="hint" id="sync-status">${verbunden ? "Verbunden mit " + esc(SYNC.repo) : "Nicht verbunden – deine eigenen Fotos und Änderungen sind nur auf diesem Gerät."}</p>
    ${verbunden ? `<div class="row"><button id="b-sync">Jetzt sichern</button><button id="b-sync-aus" class="danger">Trennen</button></div>` : `
      <label>Privates Repo<input id="in-repo" value="${esc(SYNC.repo)}"></label>
      <label>Zugangsschlüssel (GitHub-Token)<input id="in-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button id="b-verbinden" type="button">Verbinden</button>
      <details><summary>So bekommst du den Schlüssel</summary><ol class="hint">
        <li>Öffne <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>.</li>
        <li>Name: „Reise-App“, Ablauf: „No expiration“ (oder 1 Jahr).</li>
        <li>Repository access: „Only select repositories“ → <b>reise-daten</b>.</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b>.</li>
        <li>„Generate token“, kopieren und hier einfügen.</li></ol></details>`}`;
  if (verbunden) {
    document.querySelector("#b-sync").onclick = sync;
    document.querySelector("#b-sync-aus").onclick = () => { if (confirm("Sicherung auf diesem Gerät trennen? Die Daten in der Cloud bleiben erhalten.")) { localStorage.removeItem("syncToken"); zeichneSyncKarte(); } };
  } else document.querySelector("#b-verbinden").onclick = async () => {
    const t = document.querySelector("#in-token").value.trim(), repo = document.querySelector("#in-repo").value.trim();
    if (!t) return alert("Bitte den Schlüssel einfügen.");
    localStorage.setItem("syncToken", t); localStorage.setItem("syncRepo", repo);
    // Beim ersten Verbinden alle vorhandenen Fotos zum Hochladen vormerken
    for (const f of await DB.all("fotos")) if (f.sync === undefined) { f.sync = false; await DB.putRaw("fotos", f); }
    zeichneSyncKarte(); sync();
  };
}
zeichneSyncKarte();
window.addEventListener("online", () => SYNC.token && sync());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && SYNC.token) sync(); });
if (SYNC.token) setTimeout(sync, 1500);
