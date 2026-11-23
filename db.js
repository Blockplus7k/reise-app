// Mini-Wrapper um IndexedDB: Stores orte, reisen, fotos
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("reise-app", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("orte", { keyPath: "id" });
        d.createObjectStore("reisen", { keyPath: "id" });
        const f = d.createObjectStore("fotos", { keyPath: "id" });
        f.createIndex("ortId", "ortId");
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
    put: async (s, v) => req((await store(s, "readwrite")).put(v)),
    del: async (s, id) => req((await store(s, "readwrite")).delete(id)),
    byOrt: async (ortId) => req((await store("fotos")).index("ortId").getAll(ortId)),
  };
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
