const STORAGE_KEY = "JS_WebDebuggerUtils.settings.v2";
const MODE_OFF = "off";
const MODE_BLOCK = "block";
const MODE_TRACE = "trace";
const FEATURE_MODES = Object.freeze([MODE_OFF, MODE_BLOCK, MODE_TRACE]);
const DEFAULT_ENABLED = true;
const DEFAULT_CAPTURE = true;
const DEFAULT_RETAIN_LOGS = false;
const NATIVE_JSON_PARSE = JSON.parse;
const NATIVE_JSON_STRINGIFY = JSON.stringify;
const FEATURE_GROUP_LABELS = Object.freeze({
  code: "Code",
  timers: "Timers",
  window: "Window",
  navigation: "Navigation",
  document: "Document",
  network: "Network",
  JSON: "JSON",
  console: "Console"
});
const FEATURE_DEFINITIONS = Object.freeze([
  {
    group: "code",
    key: "function",
    label: "Function constructor",
    defaultMode: MODE_BLOCK,
    installer: "installFunctionHook"
  },
  {
    group: "code",
    key: "eval",
    label: "eval",
    defaultMode: MODE_BLOCK,
    installer: "installEvalHook"
  },
  {
    group: "timers",
    key: "setTimeout",
    label: "setTimeout",
    defaultMode: MODE_TRACE,
    timer: "setTimeout"
  },
  {
    group: "timers",
    key: "setInterval",
    label: "setInterval",
    defaultMode: MODE_TRACE,
    timer: "setInterval"
  },
  {
    group: "timers",
    key: "requestAnimationFrame",
    label: "requestAnimationFrame",
    defaultMode: MODE_OFF,
    api: { target: "window", property: "requestAnimationFrame", name: "window.requestAnimationFrame", blockReturn: 0 }
  },
  {
    group: "window",
    key: "windowOpen",
    label: "open",
    defaultMode: MODE_BLOCK,
    api: { target: "window", property: "open", name: "window.open", blockReturn: null }
  },
  {
    group: "window",
    key: "windowClose",
    label: "close",
    defaultMode: MODE_BLOCK,
    api: { target: "window", property: "close", name: "window.close", blockReturn: false }
  },
  {
    group: "navigation",
    key: "historyBack",
    label: "back",
    defaultMode: MODE_BLOCK,
    api: { target: "history", property: "back", name: "history.back", blockReturn: false }
  },
  {
    group: "navigation",
    key: "historyForward",
    label: "forward",
    defaultMode: MODE_BLOCK,
    api: { target: "history", property: "forward", name: "history.forward", blockReturn: false }
  },
  {
    group: "navigation",
    key: "historyGo",
    label: "go",
    defaultMode: MODE_BLOCK,
    api: { target: "history", property: "go", name: "history.go", blockReturn: false }
  },
  {
    group: "navigation",
    key: "locationHref",
    label: "href",
    defaultMode: MODE_BLOCK,
    installer: "installLocationHrefHook"
  },
  {
    group: "navigation",
    key: "locationAssign",
    label: "assign",
    defaultMode: MODE_BLOCK,
    locationMethod: "assign"
  },
  {
    group: "navigation",
    key: "locationReplace",
    label: "replace",
    defaultMode: MODE_BLOCK,
    locationMethod: "replace"
  },
  {
    group: "navigation",
    key: "locationReload",
    label: "reload",
    defaultMode: MODE_BLOCK,
    locationMethod: "reload"
  },
  {
    group: "navigation",
    key: "linkNavigation",
    label: "link click",
    defaultMode: MODE_BLOCK,
    installer: "installLinkNavigationHook"
  },
  {
    group: "document",
    key: "bodyInnerHTML",
    label: "body.innerHTML",
    defaultMode: MODE_BLOCK,
    installer: "installBodyInnerHTMLHook"
  },
  {
    group: "network",
    key: "formSubmit",
    label: "form submit",
    defaultMode: MODE_BLOCK,
    installer: "installFormSubmitHook"
  },
  {
    group: "network",
    key: "fetch",
    label: "fetch",
    defaultMode: MODE_TRACE,
    installer: "installFetchHook"
  },
  {
    group: "network",
    key: "sendBeacon",
    label: "navigator.sendBeacon",
    defaultMode: MODE_TRACE,
    installer: "installSendBeaconHook"
  },
  {
    group: "network",
    key: "xhrOpen",
    label: "XMLHttpRequest.open",
    defaultMode: MODE_TRACE,
    installer: "installXhrOpenHook"
  },
  {
    group: "network",
    key: "xhrSend",
    label: "XMLHttpRequest.send",
    defaultMode: MODE_TRACE,
    installer: "installXhrSendHook"
  },
  {
    group: "network",
    key: "jqueryAjax",
    label: "jQuery.ajax",
    defaultMode: MODE_TRACE,
    network: { library: "jquery", property: "ajax", name: "jQuery.ajax" }
  },
  {
    group: "network",
    key: "jqueryGet",
    label: "jQuery.get",
    defaultMode: MODE_TRACE,
    network: { library: "jquery", property: "get", name: "jQuery.get" }
  },
  {
    group: "network",
    key: "jqueryPost",
    label: "jQuery.post",
    defaultMode: MODE_TRACE,
    network: { library: "jquery", property: "post", name: "jQuery.post" }
  },
  {
    group: "network",
    key: "axiosRequest",
    label: "axios.request",
    defaultMode: MODE_TRACE,
    network: { library: "axios", property: "request", name: "axios.request" }
  },
  {
    group: "network",
    key: "axiosGet",
    label: "axios.get",
    defaultMode: MODE_TRACE,
    network: { library: "axios", property: "get", name: "axios.get" }
  },
  {
    group: "network",
    key: "axiosPost",
    label: "axios.post",
    defaultMode: MODE_TRACE,
    network: { library: "axios", property: "post", name: "axios.post" }
  },
  {
    group: "JSON",
    key: "jsonParse",
    label: "parse",
    defaultMode: MODE_TRACE,
    installer: "installJsonParseHook"
  },
  {
    group: "JSON",
    key: "jsonStringify",
    label: "stringify",
    defaultMode: MODE_TRACE,
    installer: "installJsonStringifyHook"
  },
  {
    group: "console",
    key: "consoleLog",
    label: "log",
    defaultMode: MODE_OFF,
    api: { target: "console", property: "log", name: "console.log" }
  },
  {
    group: "console",
    key: "consoleTable",
    label: "table",
    defaultMode: MODE_OFF,
    api: { target: "console", property: "table", name: "console.table" }
  },
  {
    group: "console",
    key: "consoleClear",
    label: "clear",
    defaultMode: MODE_OFF,
    api: { target: "console", property: "clear", name: "console.clear" }
  }
]);
const FEATURE_REGISTRY = (() => {
  const byKey = new Map(FEATURE_DEFINITIONS.map((definition) => [definition.key, definition]));
  const defaults = Object.freeze(Object.fromEntries(
    FEATURE_DEFINITIONS.map(({ key, defaultMode = MODE_OFF }) => [key, defaultMode])
  ));
  const groups = Object.freeze([...new Set(FEATURE_DEFINITIONS.map(({ group }) => group))].map((key) => Object.freeze({
    key,
    label: FEATURE_GROUP_LABELS[key] || key,
    definitions: FEATURE_DEFINITIONS.filter((definition) => definition.group === key)
  })));
  return Object.freeze({
    definitions: FEATURE_DEFINITIONS,
    byKey,
    defaults,
    groups
  });
})();
const UI_HOST_SELECTOR = "[data-js-webdebugger-utils]";
const MAX_LOG_ENTRIES = 100000;
const STACK_TRACE_LIMIT = 48;
const DATABASE_NAME = "JS_WebDebuggerUtils";
const DATABASE_VERSION = 1;
const META_STORE_NAME = "meta";
const ENTRY_STORE_NAME = "entries";
const RETAIN_META_KEY = "settings";
const UI_META_KEY = "uiState";
const DEFAULT_UI_STATE = Object.freeze({
  left: null,
  top: null,
  width: null,
  height: null
});
const UI_STYLES = String.raw`
  :host { all: initial; }
  * { box-sizing: border-box; }
  .launcher { width: 34px; height: 34px; border: 1px solid #9ca3af; background: #111827; color: #fff; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; font: 700 12px system-ui, sans-serif; }
  .launcher:hover { background: #1f2937; }
  .panel { display: flex; flex-direction: column; width: 80vw; min-width: 280px; height: min(720px, 85vh); min-height: 240px; max-width: 90vw; max-height: 85vh; overflow: hidden; overscroll-behavior: contain; resize: both; margin-top: 8px; padding: 8px; border: 1px solid #9ca3af; background: #f9fafb; color: #111827; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
  .panel[hidden] { display: none; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; cursor: move; touch-action: none; user-select: none; }
  .title { font-weight: 700; }
  .close { border: 0; background: transparent; color: #4b5563; cursor: pointer; font: 20px/1 system-ui, sans-serif; padding: 0 4px; }
  .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 10px; }
  .tab { border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; padding: 6px 8px; font: 600 12px system-ui, sans-serif; }
  .tab[aria-selected="true"] { background: #2563eb; border-color: #2563eb; color: #fff; }
  .view[hidden] { display: none; }
  .view { min-height: 0; }
  .protection-view { overflow-y: auto; overscroll-behavior-y: contain; }
  .logs-view { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }
  .master { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0 11px; border-bottom: 1px solid #d1d5db; }
  .master-toggle { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; }
  .master-actions { display: flex; flex-wrap: wrap; gap: 4px; }
  .master-action { border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; padding: 4px 6px; font: 600 11px system-ui, sans-serif; }
  .features { display: grid; gap: 8px; padding-top: 10px; }
  .feature-group { display: grid; gap: 6px; padding: 8px; border: 1px solid #d1d5db; }
  .feature-group-title { display: flex; align-items: center; justify-content: flex-start; gap: 8px; padding-bottom: 3px; border-bottom: 1px solid #d1d5db; color: #4b5563; font-size: 11px; font-weight: 700; }
  .feature { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 10px; align-items: start; }
  .feature input, .master input { accent-color: #2563eb; margin-top: 3px; }
  .feature > label { cursor: pointer; font-weight: 400; }
  .feature-controls { display: flex; gap: 8px; color: #374151; font-size: 11px; font-weight: 400; white-space: nowrap; }
  .feature-group-controls { display: flex; order: -1; gap: 8px; color: #374151; font-size: 11px; font-weight: 400; white-space: nowrap; }
  .feature-control { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
  .log-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
  .log-search { flex: 1; min-width: 0; border: 1px solid #d1d5db; padding: 5px 7px; font: 12px system-ui, sans-serif; }
  .log-toggle { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: #374151; font-size: 11px; }
  .clear-logs { border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; padding: 5px 8px; font: 600 11px system-ui, sans-serif; }
  .export-logs { border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; padding: 5px 8px; font: 600 11px system-ui, sans-serif; }
  .log-summary { margin: 0 0 7px; color: #6b7280; font-size: 11px; }
  .log-list { display: block; position: relative; flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; overflow-anchor: none; }
  .log-window { display: grid; gap: 7px; }
  .log-spacer { width: 1px; pointer-events: none; }
  .log-empty { color: #6b7280; font-size: 12px; }
  .log-entry { contain: content; border: 1px solid #d1d5db; padding: 7px; background: #fff; }
  .log-meta { color: #4b5563; font: 600 11px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .log-type { color: #6b7280; }
  .log-blocked .log-type { color: #dc2626; }
  .log-trace .log-type { color: #2563eb; }
  .log-payload { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #111827; font: 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .log-stack { margin: 5px 0 0; padding-top: 5px; border-top: 1px dashed #d1d5db; white-space: pre-wrap; overflow-wrap: anywhere; color: #6b7280; font: 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace; }
  @media (prefers-color-scheme: dark) {
    .panel { background: #111827; color: #f9fafb; border-color: #4b5563; }
    .close { color: #d1d5db; }
    .tab, .clear-logs, .export-logs, .master-action, .log-search, .log-entry { background: #1f2937; border-color: #4b5563; color: #f9fafb; }
    .tab[aria-selected="true"] { background: #2563eb; border-color: #2563eb; }
    .master, .feature-group, .feature-group-title { border-color: #374151; }
    .log-toggle, .feature-controls, .feature-group-controls { color: #9ca3af; }
    .log-empty, .log-meta, .log-summary { color: #9ca3af; }
    .log-payload { color: #f9fafb; }
    .log-stack { border-color: #4b5563; color: #9ca3af; }
  }
`;

export {
  STORAGE_KEY,
  MODE_OFF,
  MODE_BLOCK,
  MODE_TRACE,
  FEATURE_MODES,
  DEFAULT_ENABLED,
  DEFAULT_CAPTURE,
  DEFAULT_RETAIN_LOGS,
  NATIVE_JSON_PARSE,
  NATIVE_JSON_STRINGIFY,
  FEATURE_GROUP_LABELS,
  FEATURE_DEFINITIONS,
  FEATURE_REGISTRY,
  UI_HOST_SELECTOR,
  MAX_LOG_ENTRIES,
  STACK_TRACE_LIMIT,
  DATABASE_NAME,
  DATABASE_VERSION,
  META_STORE_NAME,
  ENTRY_STORE_NAME,
  RETAIN_META_KEY,
  UI_META_KEY,
  DEFAULT_UI_STATE,
  UI_STYLES
};
