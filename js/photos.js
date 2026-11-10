// Bilder lagras bara på den här enheten (IndexedDB) – de laddas aldrig upp någonstans.
(function () {
  const DB = 'familjekalender-photos', STORE = 'photos';
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  async function resize(file, max = 2048) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  window.Photos = {
    async add(files, onProgress) {
      let i = 0;
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        let blob;
        try { blob = await resize(f); } catch { continue; }
        const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        await tx('readwrite', (s) => s.put({ id, blob, added: Date.now() }));
        onProgress && onProgress(++i, files.length);
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      return i;
    },
    async all() {
      return tx('readonly', (s) => s.getAll());
    },
    async remove(id) {
      return tx('readwrite', (s) => s.delete(id));
    },
    async clear() {
      return tx('readwrite', (s) => s.clear());
    },
  };
})();
