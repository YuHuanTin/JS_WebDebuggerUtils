import {
  MODE_OFF,
  MODE_BLOCK,
  FEATURE_REGISTRY
} from "./constants.js";

export class HookManager {
  constructor(globalWindow, globalDocument, report, reportHook) {
    this.window = globalWindow;
    this.document = globalDocument;
    this.report = report;
    this.reportHook = reportHook;
    this.restorers = new Map();
    this.installedModes = new Map();
    this.jsonHookDepth = 0;
    this.blockedXhrs = new WeakSet();
    this.dynamicWatchers = new Set();
    this.dynamicProbeTimer = 0;
    this.nativeSetTimeout = this.window.setTimeout?.bind(this.window) || setTimeout;
    this.nativeClearTimeout = this.window.clearTimeout?.bind(this.window) || clearTimeout;
  }

  sync(settings) {
    for (const definition of FEATURE_REGISTRY.definitions) {
      const mode = settings.enabled ? settings.features[definition.key] : MODE_OFF;
      this.syncFeature(definition.key, mode);
    }
  }

  syncFeature(key, desiredMode) {
    const installed = this.restorers.get(key);
    if (installed && this.installedModes.get(key) === desiredMode) return;
    if (installed) {
      this.restorers.delete(key);
      this.installedModes.delete(key);
      try {
        installed();
      } catch (error) {
        this.report("hook.restore.error", {
          feature: key,
          error: String(error)
        });
      }
    }
    if (desiredMode === MODE_OFF) return;
    try {
      const restore = this.installFeature(key, desiredMode);
      if (restore) {
        this.restorers.set(key, restore);
        this.installedModes.set(key, desiredMode);
      }
    } catch (error) {
      this.report("hook.install.error", {
        feature: key,
        error: String(error)
      });
    }
  }

  installFeature(key, mode) {
    const definition = FEATURE_REGISTRY.byKey.get(key);
    if (definition?.api) return this.installApiHook(definition, mode);
    if (definition?.timer) return this.installTimerHook(definition, mode);
    if (definition?.locationMethod) {
      return this.installLocationMethodHook(definition.locationMethod, mode);
    }
    if (definition?.network) {
      return this.installNetworkHook(definition.network, mode);
    }
    if (definition?.installer) return this[definition.installer](mode);
    return null;
  }

  getApiObject(target) {
    if (target === "console") return this.window.console;
    if (target === "history") return this.window.history;
    return this.window;
  }

  createMethodHook(
    original,
    name,
    mode,
    blockReturn,
    makePayload = (args) => ({ args }),
    onBlock,
    shouldSkip,
    bypassOnSkip = false
  ) {
    const reportHook = this.reportHook;
    return function (...args) {
      const skipped = shouldSkip?.(args, this) === true;
      if (skipped && bypassOnSkip) return Reflect.apply(original, this, args);
      reportHook(name, mode, makePayload(args, this));
      if (skipped) return undefined;
      if (mode === MODE_BLOCK) return onBlock ? onBlock(args, this) : blockReturn;
      return Reflect.apply(original, this, args);
    };
  }

  installApiHook(definition, mode) {
    const { target, property, name, blockReturn } = definition.api;
    return this.installMethodHook(this.getApiObject(target), property, name, mode, { blockReturn });
  }

  installMethodHook(object, property, name, mode, options = {}) {
    if (!object) return null;
    const original = object[property];
    if (typeof original !== "function") return null;
    const replacement = this.createMethodHook(
      original,
      name,
      mode,
      options.blockReturn,
      options.makePayload,
      options.onBlock,
      options.shouldSkip,
      options.bypassOnSkip
    );
    const descriptor = Object.getOwnPropertyDescriptor(object, property);
    try {
      if (descriptor && (descriptor.get || descriptor.set || descriptor.writable === false)) {
        if (!descriptor.configurable) return null;
        Object.defineProperty(object, property, {
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          writable: true,
          value: replacement
        });
      } else {
        object[property] = replacement;
      }
    } catch {
      return null;
    }
    if (object[property] !== replacement) {
      try {
        if (descriptor) Object.defineProperty(object, property, descriptor);
        else delete object[property];
      } catch {
      }
      return null;
    }
    return () => {
      if (descriptor) Object.defineProperty(object, property, descriptor);
      else delete object[property];
    };
  }

  combineRestorers(restorers) {
    const active = restorers.filter(Boolean);
    return active.length === 0 ? null : () => {
      for (const restore of active.reverse()) {
        try {
          restore();
        } catch {
        }
      }
    };
  }

  installFunctionHook(mode) {
    const original = this.window.Function;
    const reportHook = this.reportHook;
    const patched = new Proxy(original, {
      apply: (target, thisArg, args) => {
        reportHook("Function", mode, { args });
        return mode === MODE_BLOCK ? function () { } : Reflect.apply(target, thisArg, args);
      },
      construct: (target, args, newTarget) => {
        reportHook("Function", mode, { args });
        return mode === MODE_BLOCK ? function () { } : Reflect.construct(target, args, newTarget);
      }
    });
    this.window.Function = patched;
    return () => {
      this.window.Function = original;
    };
  }

  installEvalHook(mode) {
    const original = this.window.eval;
    const reportHook = this.reportHook;
    this.window.eval = function (code, ...args) {
      reportHook("eval", mode, { code, args });
      if (mode === MODE_BLOCK) return undefined;
      return Reflect.apply(original, this, [code, ...args]);
    };
    return () => {
      this.window.eval = original;
    };
  }

  installTimerHook(definition, mode) {
    const property = definition.timer;
    return this.installMethodHook(
      this.window,
      property,
      `window.${property}`,
      mode,
      {
        blockReturn: 0,
        makePayload: ([handler, timeout, ...args]) => ({ handler: String(handler), timeout, args })
      }
    );
  }

  installDocumentListener(type, listener, options) {
    if (!this.document?.addEventListener) return null;
    this.document.addEventListener(type, listener, options);
    return () => this.document.removeEventListener(type, listener, options);
  }

  isHttpInstance(value, constructorName) {
    const Constructor = this.window[constructorName];
    return typeof Constructor === "function" && value instanceof Constructor;
  }

  describeHeaders(value) {
    if (typeof value?.entries !== "function") return value;
    const headers = {};
    try {
      for (const [name, headerValue] of value.entries()) headers[name] = String(headerValue);
      return headers;
    } catch {
      return value;
    }
  }

  describeFormData(value) {
    if (typeof value?.entries !== "function") return value;
    const fields = {};
    try {
      for (const [name, fieldValue] of value.entries()) {
        const describedValue = this.describeHttpValue(fieldValue);
        if (!Object.prototype.hasOwnProperty.call(fields, name)) {
          fields[name] = describedValue;
        } else if (Array.isArray(fields[name])) {
          fields[name].push(describedValue);
        } else {
          fields[name] = [fields[name], describedValue];
        }
      }
      return fields;
    } catch {
      return value;
    }
  }

  describeHttpValue(value, asUrl = false) {
    if (value === undefined || value === null) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol" || typeof value === "function") return String(value);
    if (asUrl) {
      if (this.isHttpInstance(value, "URL")) return String(value);
      if (value?.url !== undefined) return this.describeHttpValue(value.url, true);
      return String(value);
    }
    if (this.isHttpInstance(value, "URLSearchParams")) return String(value);
    if (this.isHttpInstance(value, "Headers")) return this.describeHeaders(value);
    if (this.isHttpInstance(value, "FormData")) return this.describeFormData(value);
    if (this.isHttpInstance(value, "Blob")) {
      const constructorName = value?.constructor?.name || "Blob";
      const description = {
        type: constructorName,
        size: Number(value.size),
        mimeType: String(value.type || "")
      };
      if (typeof value.name === "string") description.name = value.name;
      return description;
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
      return {
        type: value?.constructor?.name || "TypedArray",
        byteLength: Number(value.byteLength),
        length: Number(value.length)
      };
    }
    if (this.isHttpInstance(value, "ArrayBuffer")) {
      return {
        type: "ArrayBuffer",
        byteLength: Number(value.byteLength)
      };
    }
    return value;
  }

  describeRequest(args, defaultMethod = "GET") {
    const [input, init] = args;
    const request = input && typeof input === "object" ? input : null;
    const method = init?.method || request?.method || defaultMethod;
    const url = request?.url || input;
    return {
      method: String(method || defaultMethod).toUpperCase(),
      url: this.describeHttpValue(url, true) || "",
      body: this.describeHttpValue(init?.body)
    };
  }

  createRejectedRequest(name) {
    const PromiseConstructor = this.window.Promise || globalThis.Promise;
    return typeof PromiseConstructor?.reject === "function"
      ? PromiseConstructor.reject(new Error(`Blocked ${name}`))
      : undefined;
  }

  installFetchHook(mode) {
    return this.installMethodHook(this.window, "fetch", "fetch", mode, {
      makePayload: (args) => this.describeRequest(args),
      onBlock: () => this.createRejectedRequest("fetch")
    });
  }

  installSendBeaconHook(mode) {
    return this.installMethodHook(this.window.navigator, "sendBeacon", "navigator.sendBeacon", mode, {
      makePayload: (args) => ({
        url: this.describeHttpValue(args[0], true) || "",
        body: this.describeHttpValue(args[1])
      }),
      blockReturn: false
    });
  }

  installXhrOpenHook(mode) {
    const prototype = this.window.XMLHttpRequest?.prototype;
    return this.installMethodHook(prototype, "open", "XMLHttpRequest.open", mode, {
      makePayload: (args, xhr) => {
        this.blockedXhrs.delete(xhr);
        return {
          method: String(args[0] || "GET").toUpperCase(),
          url: this.describeHttpValue(args[1], true) || "",
          async: args[2] !== false
        };
      },
      onBlock: (_args, xhr) => {
        this.blockedXhrs.add(xhr);
        return undefined;
      }
    });
  }

  installXhrSendHook(mode) {
    const prototype = this.window.XMLHttpRequest?.prototype;
    return this.installMethodHook(prototype, "send", "XMLHttpRequest.send", mode, {
      makePayload: (args) => ({ body: this.describeHttpValue(args[0]) }),
      shouldSkip: (_args, xhr) => this.blockedXhrs.has(xhr) && xhr.readyState === 0,
      onBlock: () => undefined
    });
  }

  createFormData(form, submitter) {
    const FormDataConstructor = this.window.FormData;
    if (typeof FormDataConstructor !== "function" || !form) return null;
    if (submitter) {
      try {
        return new FormDataConstructor(form, submitter);
      } catch {
      }
    }
    try {
      return new FormDataConstructor(form);
    } catch {
      return null;
    }
  }

  getFormFieldString(value) {
    if (typeof value === "string") return value;
    if (value && typeof value.name === "string") return value.name;
    return String(value);
  }

  encodeFormData(formData, enctype) {
    if (!formData || typeof formData.entries !== "function") return null;
    try {
      if (enctype === "application/x-www-form-urlencoded") {
        const URLSearchParamsConstructor = this.window.URLSearchParams;
        if (typeof URLSearchParamsConstructor !== "function") return null;
        const params = new URLSearchParamsConstructor();
        for (const [name, value] of formData.entries()) {
          params.append(name, this.getFormFieldString(value));
        }
        return String(params);
      }
      if (enctype === "text/plain") {
        const lines = [];
        const lineBreak = String.fromCharCode(13, 10);
        for (const [name, value] of formData.entries()) {
          lines.push(`${name}=${this.getFormFieldString(value)}`);
        }
        return lines.length > 0 ? `${lines.join(lineBreak)}${lineBreak}` : "";
      }
    } catch {
    }
    return null;
  }

  getByteLength(value) {
    if (value === null || value === undefined) return null;
    const TextEncoderConstructor = this.window.TextEncoder || globalThis.TextEncoder;
    if (typeof TextEncoderConstructor !== "function") return value.length;
    try {
      return new TextEncoderConstructor().encode(value).byteLength;
    } catch {
      return value.length;
    }
  }

  describeForm(form, submitter) {
    const enctype = String(form?.enctype || form?.encoding || "application/x-www-form-urlencoded").toLowerCase();
    const method = String(form?.method || "get").toUpperCase();
    const formData = this.createFormData(form, submitter);
    const encodedData = this.encodeFormData(formData, enctype);
    const body = method === "GET" || method === "HEAD" ? null : encodedData;
    return {
      action: String(form?.action || ""),
      method,
      target: String(form?.target || ""),
      enctype,
      data: this.describeFormData(formData),
      body,
      bodyBytes: this.getByteLength(body)
    };
  }

  installFormSubmitHook(mode) {
    const restorers = [];
    const prototype = this.window.HTMLFormElement?.prototype;
    for (const property of ["submit", "requestSubmit"]) {
      restorers.push(this.installMethodHook(
        prototype,
        property,
        `HTMLFormElement.${property}`,
        mode,
        { makePayload: (args, form) => ({ form: this.describeForm(form, args[0]) }) }
      ));
    }
    const handler = (event) => {
      const form = event.target;
      if (!form || form.tagName !== "FORM") return;
      this.reportHook("HTMLFormElement.submit event", mode, {
        form: this.describeForm(form, event.submitter)
      });
      if (mode === MODE_BLOCK) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const restoreListener = this.installDocumentListener("submit", handler, true);
    if (restoreListener) restorers.push(restoreListener);
    return this.combineRestorers(restorers);
  }

  getAnchorFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node?.tagName === "A" && node.href) return node;
    }
    return event.target?.closest?.("a[href]") || null;
  }

  describeAnchor(anchor) {
    return {
      href: String(anchor?.href || ""),
      target: String(anchor?.target || ""),
      download: String(anchor?.download || "")
    };
  }

  isDownloadAnchor(anchor) {
    const href = String(anchor?.href || "");
    return Boolean(anchor?.download)
      || href.startsWith("blob:")
      || anchor?.getAttribute?.("data-js-webdebugger-utils-internal") === "true";
  }

  installLinkNavigationHook(mode) {
    const restorers = [];
    const prototype = this.window.HTMLAnchorElement?.prototype;
    restorers.push(this.installMethodHook(
      prototype,
      "click",
      "HTMLAnchorElement.click",
      mode,
      {
        makePayload: (_args, anchor) => ({ link: this.describeAnchor(anchor) }),
        shouldSkip: (_args, anchor) => this.isDownloadAnchor(anchor),
        bypassOnSkip: true
      }
    ));
    const handler = (event) => {
      const anchor = this.getAnchorFromEvent(event);
      if (!anchor || this.isDownloadAnchor(anchor) || event.defaultPrevented) return;
      this.reportHook("HTMLAnchorElement.click event", mode, {
        link: this.describeAnchor(anchor),
        trusted: event.isTrusted === true
      });
      if (mode === MODE_BLOCK) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const restoreListener = this.installDocumentListener("click", handler, true);
    if (restoreListener) restorers.push(restoreListener);
    return this.combineRestorers(restorers);
  }

  getNetworkLibraryObjects(library, property) {
    const roots = library === "jquery"
      ? [this.window.jQuery, this.window.$]
      : [this.window.axios, this.window.axios?.default];
    const objects = [];
    for (const root of roots) {
      if (!root) continue;
      objects.push(root);
      if (library === "axios" && root.Axios?.prototype) objects.push(root.Axios.prototype);
    }
    return [...new Set(objects)].filter((object) => typeof object[property] === "function");
  }

  describeLibraryRequest(library, property, args) {
    const config = args[0] && typeof args[0] === "object" ? args[0] : null;
    const defaultMethod = property === "post" ? "POST" : "GET";
    const method = config?.method
      || (library === "jquery" ? config?.type : undefined)
      || defaultMethod;
    return {
      method: String(method).toUpperCase(),
      url: this.describeHttpValue(config ? config.url : args[0], true) || "",
      data: this.describeHttpValue(config?.data ?? args[1])
    };
  }

  installNetworkHook(network, mode) {
    const { library, property, name } = network;
    return this.installDynamicMethodHooks(
      () => this.getNetworkLibraryObjects(library, property),
      property,
      name,
      mode,
      {
        makePayload: (args) => this.describeLibraryRequest(library, property, args),
        onBlock: library === "axios" ? () => this.createRejectedRequest(name) : undefined
      }
    );
  }

  installDynamicMethodHooks(resolveObjects, property, name, mode, options) {
    const state = {
      restorers: new Map(),
      stopped: false,
      resolveObjects,
      property,
      name,
      mode,
      options
    };
    const probe = () => {
      if (state.stopped) return;
      const objects = state.resolveObjects();
      let found = false;
      for (const object of objects) {
        found = true;
        if (state.restorers.has(object)) continue;
        const restore = this.installMethodHook(object, state.property, state.name, state.mode, state.options);
        if (restore) state.restorers.set(object, restore);
      }
      if (found) {
        if (state.restorers.size === 0) {
          this.report("hook.install.unavailable", { feature: state.name });
        }
        this.dynamicWatchers.delete(state);
      }
    };
    state.probe = probe;
    this.dynamicWatchers.add(state);
    probe();
    this.scheduleDynamicProbe();
    return () => {
      state.stopped = true;
      this.dynamicWatchers.delete(state);
      this.combineRestorers([...state.restorers.values()])?.();
      state.restorers.clear();
      if (this.dynamicWatchers.size === 0 && this.dynamicProbeTimer) {
        this.nativeClearTimeout(this.dynamicProbeTimer);
        this.dynamicProbeTimer = 0;
      }
    };
  }

  scheduleDynamicProbe() {
    if (this.dynamicProbeTimer || this.dynamicWatchers.size === 0) return;
    this.dynamicProbeTimer = this.nativeSetTimeout(() => {
      this.dynamicProbeTimer = 0;
      for (const watcher of [...this.dynamicWatchers]) watcher.probe();
      this.scheduleDynamicProbe();
    }, 500);
  }

  installJsonHook(property, name, mode) {
    const json = this.window.JSON;
    const original = json[property];
    const reportHook = this.reportHook;
    json[property] = (...args) => {
      if (this.jsonHookDepth > 0) return Reflect.apply(original, json, args);
      this.jsonHookDepth += 1;
      try {
        reportHook(name, mode, { args });
        if (mode === MODE_BLOCK) return undefined;
        return Reflect.apply(original, json, args);
      } finally {
        this.jsonHookDepth -= 1;
      }
    };
    return () => {
      json[property] = original;
    };
  }

  installJsonParseHook(mode) {
    return this.installJsonHook("parse", "JSON.parse", mode);
  }

  installJsonStringifyHook(mode) {
    return this.installJsonHook("stringify", "JSON.stringify", mode);
  }

  installLocationHrefHook(mode) {
    const reference = this.findDescriptor(this.window.location, "href");
    if (!reference || !reference.descriptor.configurable || typeof reference.descriptor.get !== "function" || typeof reference.descriptor.set !== "function") return null;
    const descriptor = reference.descriptor;
    const owner = reference.owner;
    const reportHook = this.reportHook;
    Object.defineProperty(owner, "href", {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        reportHook("location.href", mode, { value });
        if (mode === MODE_BLOCK) return undefined;
        return descriptor.set.call(this, value);
      }
    });
    return () => this.restoreProperty(owner, "href", descriptor);
  }

  installLocationMethodHook(name, mode) {
    const reference = this.findDescriptor(this.window.location, name);
    if (!reference || !reference.descriptor.configurable || typeof this.window.location[name] !== "function") return null;
    const descriptor = reference.descriptor;
    const owner = reference.owner;
    const original = this.window.location[name];
    const reportHook = this.reportHook;
    const replacement = function (...args) {
      reportHook(`location.${name}`, mode, { args });
      if (mode === MODE_BLOCK) return false;
      return Reflect.apply(original, this, args);
    };
    Object.defineProperty(owner, name, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: descriptor.writable,
      value: replacement
    });
    return () => this.restoreProperty(owner, name, descriptor);
  }

  installBodyInnerHTMLHook(mode) {
    const elementPrototype = this.window.Element?.prototype;
    const htmlElementPrototype = this.window.HTMLElement?.prototype;
    const ref = this.findDescriptor(elementPrototype, "innerHTML") || this.findDescriptor(htmlElementPrototype, "innerHTML");
    if (!ref || !ref.descriptor.configurable) return null;
    const original = ref.descriptor;
    const reportHook = this.reportHook;
    const document = this.document;
    if (typeof original.get !== "function" || typeof original.set !== "function") return null;
    Object.defineProperty(ref.owner, "innerHTML", {
      configurable: original.configurable,
      enumerable: original.enumerable,
      get() {
        return original.get.call(this);
      },
      set(value) {
        if (this === document.body || this?.tagName === "BODY") {
          reportHook("document.body.innerHTML", mode, { value });
          if (mode === MODE_BLOCK) return undefined;
        }
        return original.set.call(this, value);
      }
    });
    return () => this.restoreProperty(ref.owner, "innerHTML", original);
  }

  findDescriptor(object, key) {
    for (let current = object; current; current = Object.getPrototypeOf(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return { owner: current, descriptor };
    }
    return null;
  }

  restoreProperty(target, key, descriptor) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  }
}

