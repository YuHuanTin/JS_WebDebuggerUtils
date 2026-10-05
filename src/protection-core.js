import {
  MODE_OFF,
  FEATURE_MODES,
  FEATURE_REGISTRY,
  MAX_LOG_ENTRIES,
  STACK_TRACE_LIMIT,
  DEFAULT_ENABLED
} from "./constants.js";
import { SettingsStore } from "./settings-store.js";
import { LogStore } from "./log-store.js";
import { LogPersistence } from "./log-persistence.js";
import { HookManager } from "./hook-manager.js";

export class ProtectionCore {
  constructor(globalWindow, globalDocument) {
    this.window = globalWindow;
    this.native = {
      setTimeout: this.window.setTimeout.bind(this.window),
      clearTimeout: this.window.clearTimeout.bind(this.window),
      requestAnimationFrame: this.window.requestAnimationFrame.bind(this.window)
    };
    this.isTopWindow = this.window.top === this.window;
    this.settingsStore = new SettingsStore();
    this.settings = this.settingsStore.load();
    this.logStore = new LogStore(MAX_LOG_ENTRIES);
    this.logListeners = new Set();
    this.stateListeners = new Set();
    this.uiStateListeners = new Set();
    this.hooks = new HookManager(
      globalWindow,
      globalDocument,
      (type, payload) => this.report(type, payload),
      (name, mode, payload) => this.reportHook(name, mode, payload)
    );
    this.persistence = new LogPersistence(globalWindow, {
      isTopWindow: this.isTopWindow,
      logStore: this.logStore,
      callbacks: {
        onLogsChange: () => this.notifyLogListeners(),
        onStateChange: () => this.notifyStateListeners(),
        onUiStateChange: (state) => this.notifyListeners(this.uiStateListeners, state)
      }
    });
    this.settingsStore.subscribe((settings) => {
      this.settings = settings;
      this.sync();
      this.notifyStateListeners();
    });
    this.persistence.initialize();
  }

  start() {
    this.sync();
  }

  runNativeAnimationFrame(callback) {
    return this.native.requestAnimationFrame(callback);
  }

  runNativeTimeout(callback, delay) {
    return this.native.setTimeout(callback, delay);
  }

  cancelNativeTimeout(timer) {
    if (timer) this.native.clearTimeout(timer);
  }

  getState() {
    return {
      enabled: this.settings.enabled,
      capture: this.settings.capture,
      retainLogs: this.persistence.retainLogs,
      features: { ...this.settings.features }
    };
  }

  forEachLog(listener) {
    this.logStore.forEach(listener);
  }

  getLogCount() {
    return this.logStore.length;
  }

  subscribeLogs(listener) {
    this.logListeners.add(listener);
  }

  subscribeState(listener) {
    this.stateListeners.add(listener);
  }

  getUiState() {
    return this.persistence.getUiState();
  }

  subscribeUiState(listener) {
    this.uiStateListeners.add(listener);
  }

  setUiState(value) {
    this.persistence.setUiState(value);
  }

  clearLogs() {
    this.logStore.clear();
    this.persistence.clearLogs();
    this.notifyLogListeners();
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (this.settings.enabled === nextEnabled) return;
    this.settings.enabled = nextEnabled;
    this.commitSettingsAndSync();
  }

  setCaptureEnabled(enabled) {
    const nextCapture = Boolean(enabled);
    if (this.settings.capture === nextCapture) return;
    this.settings.capture = nextCapture;
    this.commitSettings();
  }

  setRetainLogs(enabled) {
    const nextRetainLogs = Boolean(enabled);
    if (this.persistence.retainLogs === nextRetainLogs) return;
    this.persistence.setRetainLogs(nextRetainLogs);
    this.notifyStateListeners();
  }

  setFeatureMode(key, mode) {
    const nextMode = FEATURE_MODES.includes(mode) ? mode : MODE_OFF;
    if (this.settings.features[key] === nextMode) return;
    this.settings.features[key] = nextMode;
    this.syncFeature(key);
    this.commitSettings();
  }

  updateFeatureModes(getMode) {
    let changed = false;
    for (const definition of FEATURE_REGISTRY.definitions) {
      const nextMode = getMode(definition);
      if (this.settings.features[definition.key] === nextMode) continue;
      this.settings.features[definition.key] = nextMode;
      changed = true;
    }
    if (!changed) return;
    this.commitSettingsAndSync();
  }

  setAllFeatureMode(mode) {
    const nextMode = FEATURE_MODES.includes(mode) ? mode : MODE_OFF;
    this.updateFeatureModes(() => nextMode);
  }

  setFeatureGroupMode(group, mode) {
    const nextMode = FEATURE_MODES.includes(mode) ? mode : MODE_OFF;
    this.updateFeatureModes((definition) => (
      definition.group === group ? nextMode : this.settings.features[definition.key]
    ));
  }

  resetFeatureModes() {
    this.updateFeatureModes(({ defaultMode = MODE_OFF }) => defaultMode);
  }

  resetMainDefaults() {
    this.settings.enabled = DEFAULT_ENABLED;
    this.settings.features = { ...FEATURE_REGISTRY.defaults };
    this.sync();
    this.saveSettings();
    this.notifyStateListeners();
  }

  commitSettings() {
    this.saveSettings();
    this.notifyStateListeners();
  }

  commitSettingsAndSync() {
    this.sync();
    this.commitSettings();
  }

  saveSettings() {
    this.settingsStore.save(this.settings);
  }

  notifyStateListeners() {
    this.notifyListeners(this.stateListeners, this.getState());
  }

  notifyLogListeners(entry) {
    this.notifyListeners(this.logListeners, entry);
  }

  notifyListeners(listeners, value) {
    for (const listener of listeners) listener(value);
  }

  report(type, payload) {
    if (!this.settings.capture) return;
    const entry = {
      time: new Date(),
      type,
      payload,
      stack: this.captureStack()
    };
    const sequence = this.logStore.append(entry);
    this.persistence.append(entry, sequence);
    this.notifyLogListeners(entry);
  }

  reportHook(name, mode, payload) {
    this.report(`[${mode}] ${name}`, payload);
  }

  sync() {
    this.hooks.sync(this.settings);
  }

  syncFeature(key) {
    const desiredMode = this.settings.enabled ? this.settings.features[key] : MODE_OFF;
    this.hooks.syncFeature(key, desiredMode);
  }

  captureStack() {
    const ErrorConstructor = this.window.Error || Error;
    const previousLimit = ErrorConstructor.stackTraceLimit;
    const configuredLimit = Number(previousLimit);
    const nextLimit = previousLimit === Infinity
      ? Infinity
      : Number.isFinite(configuredLimit)
        ? Math.max(configuredLimit, STACK_TRACE_LIMIT)
        : STACK_TRACE_LIMIT;
    const changed = nextLimit !== previousLimit;
    try {
      if (changed) ErrorConstructor.stackTraceLimit = nextLimit;
      return String(new ErrorConstructor().stack || "");
    } finally {
      if (changed) ErrorConstructor.stackTraceLimit = previousLimit;
    }
  }
}

