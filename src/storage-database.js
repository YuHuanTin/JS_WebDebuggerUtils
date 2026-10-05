import {
  DATABASE_NAME,
  DATABASE_VERSION,
  META_STORE_NAME,
  ENTRY_STORE_NAME,
  RETAIN_META_KEY,
  UI_META_KEY
} from "./constants.js";

export class StorageDatabase {
  constructor(globalWindow) {
    this.window = globalWindow;
    this.connection = null;
    this.onUnavailable = () => { };
  }

  open() {
    const indexedDb = this.window.indexedDB;
    if (!indexedDb) return Promise.reject(new Error("IndexedDB is unavailable."));
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => this.createSchema(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
      request.onsuccess = () => {
        const database = request.result;
        this.connection = database;
        database.onversionchange = () => {
          database.close();
          if (this.connection === database) this.connection = null;
          this.onUnavailable();
        };
        this.readState().then(resolve, reject);
      };
    });
  }

  createSchema(database) {
    if (!database.objectStoreNames.contains(META_STORE_NAME)) {
      database.createObjectStore(META_STORE_NAME, { keyPath: "key" });
    }
    if (!database.objectStoreNames.contains(ENTRY_STORE_NAME)) {
      database.createObjectStore(ENTRY_STORE_NAME, { keyPath: "slot" });
    }
  }

  readState() {
    let settingsRequest;
    let uiStateRequest;
    let entriesRequest;
    return this.transact([META_STORE_NAME, ENTRY_STORE_NAME], "readonly", (transaction) => {
      const metaStore = transaction.objectStore(META_STORE_NAME);
      settingsRequest = metaStore.get(RETAIN_META_KEY);
      uiStateRequest = metaStore.get(UI_META_KEY);
      entriesRequest = transaction.objectStore(ENTRY_STORE_NAME).getAll();
    }, () => ({
      retain: settingsRequest.result?.retain === true,
      uiState: uiStateRequest.result?.value,
      entries: entriesRequest.result || []
    }));
  }

  writeLog(record) {
    return this.transact(ENTRY_STORE_NAME, "readwrite", (transaction) => {
      transaction.objectStore(ENTRY_STORE_NAME).put(record);
    });
  }

  replaceLogs(records) {
    return this.transact([META_STORE_NAME, ENTRY_STORE_NAME], "readwrite", (transaction) => {
      const entries = transaction.objectStore(ENTRY_STORE_NAME);
      entries.clear();
      for (const record of records) entries.put(record);
      transaction.objectStore(META_STORE_NAME).put({ key: RETAIN_META_KEY, retain: true });
    });
  }

  clearLogs({ retain = false } = {}) {
    return this.transact([META_STORE_NAME, ENTRY_STORE_NAME], "readwrite", (transaction) => {
      transaction.objectStore(ENTRY_STORE_NAME).clear();
      const metaStore = transaction.objectStore(META_STORE_NAME);
      if (retain) metaStore.put({ key: RETAIN_META_KEY, retain: true });
      else metaStore.delete(RETAIN_META_KEY);
    });
  }

  writeUiState(state) {
    return this.transact(META_STORE_NAME, "readwrite", (transaction) => {
      transaction.objectStore(META_STORE_NAME).put({
        key: UI_META_KEY,
        value: state
      });
    });
  }

  transact(storeNames, mode, operation, readResult = () => undefined) {
    if (!this.connection) return Promise.reject(new Error("IndexedDB is not open."));
    return new Promise((resolve, reject) => {
      let transaction;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error || new Error("IndexedDB transaction failed."));
      };
      try {
        transaction = this.connection.transaction(storeNames, mode);
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(readResult());
        };
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(transaction.error);
        operation(transaction);
      } catch (error) {
        fail(error);
        try {
          transaction?.abort();
        } catch { }
      }
    });
  }
}

