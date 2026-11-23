// Mini-Wrapper um IndexedDB: Stores orte, reisen, fotos
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("reise-app", 2);
      r.onupgradeneeded = (e) => {
        const d = r.result;
        if (e.oldVersion < 1) {
          d.createObjectStore("orte", { keyPath: "id" });
          d.createObjectStore("reisen", { keyPath: "id" });
          const f = d.createObjectStore("fotos", { keyPath: "id" });
          f.createIndex("ortId", "ortId");
        }
        if (e.oldVersion < 2) d.createObjectStore("laender", { keyPath: "code" }); // {code: ISO2, status: besucht|gelebt|wunsch}
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function store(name, mode = "readonly") { return (await open()).transaction(name, mode).objectStore(name); }
  return {
    all: async (s) => req((await store(s)).getAll()),
    get: async (s, id) => req((await store(s)).get(id)),
    // put/del merken Änderungen für die Cloud-Sicherung (sync.js); putRaw/delRaw nicht (für den Abgleich selbst)
    put: async (s, v) => { v.geaendert = Date.now(); if (s === "fotos") v.sync = false;
      const r = await req((await store(s, "readwrite")).put(v)); window.planeSync?.(); return r; },
    del: async (s, id) => { const r = await req((await store(s, "readwrite")).delete(id));
      try { const t = JSON.parse(localStorage.getItem("geloescht") || "{}"); t[s + ":" + id] = Date.now(); localStorage.setItem("geloescht", JSON.stringify(t)); } catch {}
      window.planeSync?.(); return r; },
    putRaw: async (s, v) => req((await store(s, "readwrite")).put(v)),
    delRaw: async (s, id) => req((await store(s, "readwrite")).delete(id)),
    byOrt: async (ortId) => req((await store("fotos")).index("ortId").getAll(ortId)),
  };
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
