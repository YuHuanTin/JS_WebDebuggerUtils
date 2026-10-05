import { NATIVE_JSON_STRINGIFY } from "./constants.js";

class JsonValueSerializer {
  static stringify(value, space) {
    try {
      return NATIVE_JSON_STRINGIFY(value, this.createReplacer(), space);
    } catch {
      return null;
    }
  }

  static createReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
      if (typeof value === "bigint") return `${value}n`;
      if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    };
  }
}

export { JsonValueSerializer };
