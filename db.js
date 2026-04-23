/**
 * SQLite (sql.js) + IndexedDB: одна копия базы в браузере, без Node.
 * Файл wasm: vendor/sql-wasm.wasm, загрузчик: vendor/sql-wasm.js (объявляет initSqlJs)
 */
(function (global) {
  const IDB = { name: "attestation_idb_v1", store: "kv", key: "sqlite" };

  const engine = { SQL: null, db: null, initPromise: null };

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB.name, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(IDB.store)) {
          r.result.createObjectStore(IDB.store);
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function idbGetBuffer() {
    return idbOpen().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(IDB.store, "readonly");
          const q = t.objectStore(IDB.store).get(IDB.key);
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        }),
    );
  }

  function idbSetBuffer(u8) {
    return idbOpen().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(IDB.store, "readwrite");
          t.objectStore(IDB.store).put(u8, IDB.key);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        }),
    );
  }

  function wasmDir() {
    return "vendor/";
  }

  function ensureSchema() {
    engine.db.run(`CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  const AtteDB = {
    init() {
      if (engine.initPromise) return engine.initPromise;
      if (typeof initSqlJs === "undefined") {
        return Promise.reject(new Error("initSqlJs не найден. Подключите vendor/sql-wasm.js"));
      }
      engine.initPromise = (async () => {
        const SQL = await initSqlJs({ locateFile: (f) => `${wasmDir()}${f}` });
        engine.SQL = SQL;
        const existing = await idbGetBuffer();
        if (existing) {
          const bytes = existing instanceof ArrayBuffer ? new Uint8Array(existing) : new Uint8Array(existing);
          if (bytes.byteLength > 0) {
            engine.db = new SQL.Database(bytes);
          } else {
            engine.db = new SQL.Database();
          }
        } else {
          engine.db = new SQL.Database();
        }
        ensureSchema();
      })();
      return engine.initPromise;
    },

    getJson() {
      if (!engine.db) return null;
      const r = engine.db.exec("SELECT payload FROM app_state WHERE id = 1");
      if (!r.length || !r[0].values || !r[0].values.length) return null;
      try {
        return JSON.parse(r[0].values[0][0]);
      } catch {
        return null;
      }
    },

    setJsonFromState(obj) {
      if (!engine.db) {
        return Promise.reject(new Error("БД не инициализирована"));
      }
      const json = JSON.stringify(obj);
      engine.db.run("INSERT OR REPLACE INTO app_state (id, payload, updated_at) VALUES (1, ?, datetime('now'))", [
        json,
      ]);
      const exported = engine.db.export();
      return idbSetBuffer(exported);
    },
  };

  global.AtteDB = AtteDB;
})(typeof window !== "undefined" ? window : globalThis);
