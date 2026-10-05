import {
  STORAGE_KEY,
  FEATURE_MODES,
  FEATURE_REGISTRY,
  DEFAULT_ENABLED,
  DEFAULT_CAPTURE
} from "./constants.js";

export class SettingsStore {
  constructor() {
    this.listeners = new Set();
    GM_addValueChangeListener(STORAGE_KEY, (_key, _oldValue, newValue, remote) => {
      if (remote) this.notify(this.normalize(newValue));
    });
  }

  load() {
    return this.normalize(GM_getValue(STORAGE_KEY, null));
  }

  save(settings) {
    GM_setValue(STORAGE_KEY, settings);
  }

  subscribe(listener) {
    this.listeners.add(listener);
  }

  normalize(value) {
    const features = { ...FEATURE_REGISTRY.defaults };
    const storedFeatures = value?.features || {};
    for (const definition of FEATURE_REGISTRY.definitions) {
      const storedMode = storedFeatures[definition.key];
      if (FEATURE_MODES.includes(storedMode)) features[definition.key] = storedMode;
    }
    return {
      enabled: value?.enabled === undefined ? DEFAULT_ENABLED : value.enabled !== false,
      capture: value?.capture === undefined ? DEFAULT_CAPTURE : value.capture !== false,
      features
    };
  }

  notify(settings) {
    for (const listener of this.listeners) listener(settings);
  }
}

