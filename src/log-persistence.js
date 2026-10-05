import {
  NATIVE_JSON_PARSE,
  NATIVE_JSON_STRINGIFY,
  MAX_LOG_ENTRIES,
  DEFAULT_UI_STATE,
  DEFAULT_RETAIN_LOGS
} from "./constants.js";
import { JsonValueSerializer } from "./serializer.js";
import { StorageDatabase } from "./storage-database.js";

export class LogPersistence {
  constructor(globalWindow, { isTopWindow, logStore, callbacks }) {
    this.window = globalWindow;
    this.isTopWindow = isTopWindow;
    this.logStore = logStore;
    this.callbacks = callbacks;
    this.database = null;
    this.status = isTopWindow ? "loading" : "disabled";
    this.pendingEntries = [];
    this.pendingRetain = null;
    this.pendingClear = false;
    this.retainLogs = DEFAULT_RETAIN_LOGS;
    this.uiState = this.normalizeUiState(null);
    this.pendingUiState = null;
  }

  initialize() {
    if (!this.isTopWindow) return;
    this.database = new StorageDatabase(this.window);
    this.database.onUnavailable = () => this.handleError("unavailable");
    this.database.open()
      .then((snapshot) => this.finishLoad(snapshot))
      .catch(() => this.handleError("unavailable"));
  }

  getUiState() {
    return { ...this.uiState };
  }

  setUiState(value) {
    this.uiState = this.normalizeUiState(value);
    if (this.status === "loading") this.pendingUiState = this.uiState;
    else this.persistUiState();
  }

  setRetainLogs(enabled) {
    this.retainLogs = Boolean(enabled);
    if (this.status === "loading") {
      this.pendingRetain = this.retainLogs;
      if (!this.retainLogs) this.pendingClear = true;
    } else if (this.retainLogs) {
      this.replacePersistedLogs();
    } else {
      this.clearPersistedLogs();
    }
  }

  append(entry, sequence) {
    if (this.status === "loading") this.pendingEntries.push(entry);
    else if (this.retainLogs) this.persistLogEntry(entry, sequence);
  }

  clearLogs() {
    this.pendingEntries = [];
    if (this.status === "loading") this.pendingClear = true;
    else this.clearPersistedLogs();
  }

  handleError(status) {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStateChange();
  }

  finishLoad(snapshot) {
    const storedRetain = snapshot.retain;
    const retain = this.pendingRetain === null ? storedRetain : this.pendingRetain;
    const shouldRestore = retain && storedRetain && !this.pendingClear;
    const queuedEntries = this.pendingEntries;
    this.pendingEntries = [];

    if (shouldRestore) {
      this.logStore.clear();
      snapshot.entries
        .filter((record) => Number.isSafeInteger(record?.sequence))
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-MAX_LOG_ENTRIES)
        .forEach((record) => {
          const entry = this.deserializeLogEntry(record);
          if (entry) this.logStore.append(entry, record.sequence);
        });
      for (const entry of queuedEntries) this.logStore.append(entry);
    }

    this.retainLogs = retain;
    this.uiState = this.pendingUiState || this.normalizeUiState(snapshot.uiState);
    this.status = "ready";
    this.pendingRetain = null;
    this.pendingClear = false;
    if (retain) this.replacePersistedLogs();
    else this.clearPersistedLogs();
    this.persistUiState();
    this.callbacks.onLogsChange();
    this.callbacks.onStateChange();
    this.callbacks.onUiStateChange(this.getUiState());
  }

  normalizeUiState(value) {
    return {
      left: Number.isFinite(value?.left) ? value.left : DEFAULT_UI_STATE.left,
      top: Number.isFinite(value?.top) ? value.top : DEFAULT_UI_STATE.top,
      width: Number.isFinite(value?.width) ? value.width : DEFAULT_UI_STATE.width,
      height: Number.isFinite(value?.height) ? value.height : DEFAULT_UI_STATE.height
    };
  }

  persistUiState() {
    this.runDatabase(() => this.database.writeUiState(this.uiState));
  }

  serializeLogEntry(entry, sequence) {
    const serializedPayload = JsonValueSerializer.stringify(entry.payload);
    const payload = serializedPayload === null
      ? NATIVE_JSON_STRINGIFY(String(entry.payload))
      : serializedPayload;
    return {
      slot: sequence % MAX_LOG_ENTRIES,
      sequence,
      time: entry.time.toISOString(),
      type: String(entry.type),
      payload,
      stack: String(entry.stack || "")
    };
  }

  deserializeLogEntry(record) {
    const time = new Date(record.time);
    if (Number.isNaN(time.getTime())) return null;
    let payload;
    try {
      payload = record.payload === undefined ? undefined : NATIVE_JSON_PARSE(record.payload);
    } catch {
      payload = record.payload;
    }
    return {
      time,
      type: String(record.type || ""),
      payload,
      stack: String(record.stack || "")
    };
  }

  persistLogEntry(entry, sequence) {
    if (!this.retainLogs) return;
    this.runDatabase(() => this.database.writeLog(this.serializeLogEntry(entry, sequence)));
  }

  replacePersistedLogs() {
    if (!this.retainLogs || !this.database || this.status !== "ready") return;
    const records = this.logStore.toRecords()
      .map(({ entry, sequence }) => this.serializeLogEntry(entry, sequence));
    this.runDatabase(() => this.database.replaceLogs(records));
  }

  clearPersistedLogs() {
    this.runDatabase(() => this.database.clearLogs({ retain: this.retainLogs }));
  }

  runDatabase(operation) {
    if (!this.database || this.status !== "ready") return;
    try {
      Promise.resolve(operation()).catch(() => this.handleError("error"));
    } catch {
      this.handleError("error");
    }
  }
}

