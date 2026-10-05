import {
  MODE_OFF,
  MODE_BLOCK,
  MODE_TRACE,
  FEATURE_REGISTRY,
  UI_HOST_SELECTOR,
  MAX_LOG_ENTRIES,
  UI_STYLES
} from "./constants.js";
import { JsonValueSerializer } from "./serializer.js";
import { VirtualLogList } from "./virtual-log-list.js";
import { LogRenderScheduler } from "./log-render-scheduler.js";

export class UtilsUi {
  constructor(globalWindow, globalDocument, controller) {
    this.window = globalWindow;
    this.document = globalDocument;
    this.controller = controller;
    this.host = null;
    this.root = null;
    this.panel = null;
    this.masterInput = null;
    this.captureInput = null;
    this.retainLogsInput = null;
    this.featureInputs = new Map();
    this.groupInputs = new Map();
    this.logList = null;
    this.virtualLogList = null;
    this.logsTab = null;
    this.protectionTab = null;
    this.protectionView = null;
    this.logsView = null;
    this.logSearch = null;
    this.searchStackInput = null;
    this.searchTextInput = null;
    this.followLatestInput = null;
    this.followLatest = true;
    this.logSummary = null;
    this.dragState = null;
    this.uiState = this.controller.getUiState();
    this.panelResizeObserver = null;
    this.logQuery = "";
    this.logViewCache = new WeakMap();
    this.logSearchCache = new WeakMap();
    this.suppressLauncherClick = false;
    this.scrollContainers = new Set();
    this.touchPoint = null;
    this.onPointerMove = (event) => this.moveDrag(event);
    this.onPointerEnd = () => this.endDrag();
    this.onWheel = (event) => this.handleScrollGesture(event);
    this.onTouchStart = (event) => this.handleTouchStart(event);
    this.onTouchMove = (event) => this.handleScrollGesture(event);
    this.onTouchEnd = () => { this.touchPoint = null; };
    this.onLogsChanged = (entry) => this.handleLogChange(entry);
    this.onStateChanged = () => this.render();
    this.onUiStateChanged = (state) => {
      this.uiState = state;
      if (this.host) {
        this.applySavedPosition();
        if (this.panel) this.applySavedSize();
      }
    };
    this.logScheduler = new LogRenderScheduler({
      runAnimationFrame: (callback) => this.controller.runNativeAnimationFrame(callback),
      runTimeout: (callback, delay) => this.controller.runNativeTimeout(callback, delay),
      cancelTimeout: (timer) => this.controller.cancelNativeTimeout(timer),
      isVisible: () => Boolean(this.logsView && !this.logsView.hidden),
      renderAll: () => this.renderLogs(),
      appendEntries: (entries) => this.appendLogEntries(entries)
    });
    this.controller.subscribeUiState(this.onUiStateChanged);
  }

  applySavedPosition() {
    if (this.uiState.left === null || this.uiState.top === null) return;
    this.host.style.left = `${this.uiState.left}px`;
    this.host.style.top = `${this.uiState.top}px`;
    this.host.style.right = "auto";
  }

  applySavedSize() {
    if (this.uiState.width !== null) this.panel.style.width = `${this.uiState.width}px`;
    if (this.uiState.height !== null) this.panel.style.height = `${this.uiState.height}px`;
  }

  saveUiState() {
    if (!this.host || !this.panel) return;
    const hostRect = this.host.getBoundingClientRect();
    const panelRect = this.panel.hidden ? null : this.panel.getBoundingClientRect();
    const nextState = {
      left: hostRect.left,
      top: hostRect.top,
      width: panelRect?.width || this.uiState.width,
      height: panelRect?.height || this.uiState.height
    };
    if (nextState.left === this.uiState.left
      && nextState.top === this.uiState.top
      && nextState.width === this.uiState.width
      && nextState.height === this.uiState.height) return;
    this.uiState = nextState;
    this.controller.setUiState(this.uiState);
  }

  mountWhenReady() {
    if (this.document.documentElement) {
      this.mount();
      return;
    }
    this.document.addEventListener("DOMContentLoaded", () => this.mount(), { once: true });
  }

  createButton(className, label, action) {
    const button = this.document.createElement("button");
    button.className = className;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  createToggle(className, text, onChange) {
    const label = this.document.createElement("label");
    label.className = className;
    const input = this.document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", onChange);
    label.append(input, this.document.createTextNode(text));
    return { label, input };
  }

  createModeControls(className, onChange) {
    const container = this.document.createElement("div");
    container.className = className;
    let trace;
    const block = this.createToggle("feature-control", "block", () => {
      if (block.input.checked) trace.input.checked = false;
      onChange(block.input.checked ? MODE_BLOCK : MODE_OFF);
    });
    trace = this.createToggle("feature-control", "trace", () => {
      if (trace.input.checked) block.input.checked = false;
      onChange(trace.input.checked ? MODE_TRACE : MODE_OFF);
    });
    container.append(block.label, trace.label);
    return {
      container,
      block: block.input,
      trace: trace.input
    };
  }

  getEventPath(event) {
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      if (path.length > 0) return path;
    }
    if (event.target && this.host && (event.target === this.host || this.host.contains(event.target))) {
      return [event.target, this.panel, this.host];
    }
    return event.target ? [event.target] : [];
  }

  isPanelEvent(path) {
    return Boolean(this.panel && !this.panel.hidden && path.includes(this.panel));
  }

  findScrollContainer(path) {
    for (const node of path) {
      if (this.scrollContainers.has(node)) return node;
    }
    return null;
  }

  canScroll(container, deltaX, deltaY) {
    if (!container) return false;
    let hasDelta = false;
    if (deltaY) {
      hasDelta = true;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const atTop = container.scrollTop <= 1;
      const atBottom = container.scrollTop >= maxTop - 1;
      if (maxTop <= 1 || (deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) return false;
    }
    if (deltaX) {
      hasDelta = true;
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const atLeft = container.scrollLeft <= 1;
      const atRight = container.scrollLeft >= maxLeft - 1;
      if (maxLeft <= 1 || (deltaX < 0 && atLeft) || (deltaX > 0 && atRight)) return false;
    }
    return hasDelta;
  }

  handleTouchStart(event) {
    const path = this.getEventPath(event);
    if (!this.isPanelEvent(path)) {
      this.touchPoint = null;
      return;
    }
    const touch = event.touches?.[0];
    this.touchPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
    event.stopImmediatePropagation();
  }

  handleScrollGesture(event) {
    const path = this.getEventPath(event);
    if (!this.isPanelEvent(path)) return;

    let deltaX = event.deltaX || 0;
    let deltaY = event.deltaY || 0;
    if (event.type === "touchmove") {
      const touch = event.touches?.[0];
      if (touch) {
        if (this.touchPoint) {
          deltaX = this.touchPoint.x - touch.clientX;
          deltaY = this.touchPoint.y - touch.clientY;
        }
        this.touchPoint = { x: touch.clientX, y: touch.clientY };
      }
    }

    const container = this.findScrollContainer(path);
    if (!this.canScroll(container, deltaX, deltaY) && event.cancelable) {
      event.preventDefault();
    }
    event.stopImmediatePropagation();
  }

  installScrollGuard() {
    this.window.addEventListener("wheel", this.onWheel, { capture: true, passive: false });
    this.window.addEventListener("touchstart", this.onTouchStart, { capture: true, passive: true });
    this.window.addEventListener("touchmove", this.onTouchMove, { capture: true, passive: false });
    this.window.addEventListener("touchend", this.onTouchEnd, { capture: true, passive: true });
    this.window.addEventListener("touchcancel", this.onTouchEnd, { capture: true, passive: true });
  }

  createMasterControls() {
    const master = this.document.createElement("div");
    master.className = "master";
    const masterLabel = this.document.createElement("label");
    masterLabel.className = "master-toggle";
    this.masterInput = this.document.createElement("input");
    this.masterInput.type = "checkbox";
    masterLabel.append(this.masterInput, this.document.createTextNode("Enable protection"));
    const masterActions = this.document.createElement("div");
    masterActions.className = "master-actions";
    const actions = [
      ["Default", () => this.controller.resetMainDefaults()],
      ["Block All", () => this.controller.setAllFeatureMode(MODE_BLOCK)],
      ["Trace All", () => this.controller.setAllFeatureMode(MODE_TRACE)],
      ["Cancel All", () => this.controller.setAllFeatureMode(MODE_OFF)]
    ];
    for (const [label, action] of actions) {
      masterActions.appendChild(this.createButton("master-action", label, action));
    }
    master.append(masterLabel, masterActions);
    return master;
  }

  createFeatureList() {
    const featureList = this.document.createElement("div");
    featureList.className = "features";
    this.featureInputs.clear();
    this.groupInputs.clear();
    for (const group of FEATURE_REGISTRY.groups) {
      const featureGroup = this.document.createElement("div");
      featureGroup.className = "feature-group";
      const groupTitle = this.document.createElement("div");
      groupTitle.className = "feature-group-title";
      const groupLabel = this.document.createElement("span");
      groupLabel.textContent = group.label;
      const groupControls = this.createModeControls(
        "feature-group-controls",
        (mode) => this.controller.setFeatureGroupMode(group.key, mode)
      );
      groupTitle.append(groupLabel, groupControls.container);
      featureGroup.appendChild(groupTitle);
      featureList.appendChild(featureGroup);
      this.groupInputs.set(group.key, groupControls);

      for (const definition of group.definitions) {
        const row = this.document.createElement("div");
        row.className = "feature";
        const text = this.document.createElement("label");
        text.append(this.document.createTextNode(definition.label));
        const controls = this.createModeControls(
          "feature-controls",
          (mode) => this.controller.setFeatureMode(definition.key, mode)
        );
        this.featureInputs.set(definition.key, controls);
        row.append(controls.container, text);
        featureGroup.appendChild(row);
      }
    }
    return featureList;
  }

  createLogToolbar() {
    const toolbar = this.document.createElement("div");
    toolbar.className = "log-toolbar";
    this.logSearch = this.document.createElement("input");
    this.logSearch.className = "log-search";
    this.logSearch.type = "search";
    this.logSearch.placeholder = "Search logs";
    this.logSearch.addEventListener("input", () => {
      this.logQuery = this.logSearch.value.trim().toLowerCase();
      this.logScheduler.scheduleSearch(this.logQuery);
    });
    const searchStack = this.createToggle("log-toggle", "仅搜索堆栈", () => {
      if (searchStack.input.checked) searchText.input.checked = false;
      if (this.logQuery) this.logScheduler.scheduleSearch(this.logQuery);
    });
    this.searchStackInput = searchStack.input;
    const searchText = this.createToggle("log-toggle", "仅搜索文本", () => {
      if (searchText.input.checked) searchStack.input.checked = false;
      if (this.logQuery) this.logScheduler.scheduleSearch(this.logQuery);
    });
    this.searchTextInput = searchText.input;
    const capture = this.createToggle("log-toggle", "Capture", () => {
      this.controller.setCaptureEnabled(this.captureInput.checked);
    });
    this.captureInput = capture.input;
    const retain = this.createToggle("log-toggle", "Keep logs", () => {
      this.controller.setRetainLogs(this.retainLogsInput.checked);
    });
    this.retainLogsInput = retain.input;
    const follow = this.createToggle("log-toggle", "Follow latest", () => {
      this.followLatest = this.followLatestInput.checked;
      if (this.followLatest) this.scrollLogsToLatest();
    });
    this.followLatestInput = follow.input;
    this.followLatestInput.checked = this.followLatest;
    const clear = this.createButton("clear-logs", "Clear logs", () => this.controller.clearLogs());
    const exportButton = this.createButton("export-logs", "Export", () => this.exportLogs());
    toolbar.append(
      this.logSearch,
      searchStack.label,
      searchText.label,
      capture.label,
      retain.label,
      follow.label,
      clear,
      exportButton
    );
    return toolbar;
  }

  mount() {
    if (this.document.querySelector(UI_HOST_SELECTOR) || !this.document.documentElement) return null;
    this.host = this.document.createElement("div");
    this.host.dataset.jsWebdebuggerUtils = "true";
    this.host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;display:block;";
    this.applySavedPosition();
    this.document.documentElement.appendChild(this.host);
    this.root = this.host.attachShadow ? this.host.attachShadow({ mode: "open" }) : this.host;

    const style = this.document.createElement("style");
    style.textContent = UI_STYLES;
    this.root.appendChild(style);

    const launcher = this.document.createElement("button");
    launcher.className = "launcher";
    launcher.type = "button";
    launcher.draggable = false;
    launcher.title = "Open JS WebUtils";
    launcher.textContent = "DU";
    launcher.addEventListener("pointerdown", (event) => this.startDrag(event, "launcher"));

    this.panel = this.document.createElement("section");
    this.panel.className = "panel";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "JS WebUtils");
    this.applySavedSize();

    const header = this.document.createElement("div");
    header.className = "header";
    const title = this.document.createElement("span");
    title.className = "title";
    title.textContent = "JS WebUtils";
    const close = this.document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.title = "Close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "x";
    header.append(title, close);

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest?.("button")) return;
      this.startDrag(event, "panel");
    });

    const tabs = this.document.createElement("div");
    tabs.className = "tabs";
    this.protectionTab = this.document.createElement("button");
    this.protectionTab.className = "tab";
    this.protectionTab.type = "button";
    this.protectionTab.textContent = "Main";
    this.protectionTab.addEventListener("click", () => this.selectTab("protection"));
    this.logsTab = this.document.createElement("button");
    this.logsTab.className = "tab";
    this.logsTab.type = "button";
    this.logsTab.addEventListener("click", () => this.selectTab("logs"));
    tabs.append(this.protectionTab, this.logsTab);

    const master = this.createMasterControls();
    const featureList = this.createFeatureList();

    this.protectionView = this.document.createElement("div");
    this.protectionView.className = "view protection-view";
    this.protectionView.append(master, featureList);

    this.logsView = this.document.createElement("div");
    this.logsView.className = "view logs-view";
    this.logsView.hidden = true;
    const logToolbar = this.createLogToolbar();
    this.logSummary = this.document.createElement("p");
    this.logSummary.className = "log-summary";
    this.logList = this.document.createElement("div");
    this.logList.className = "log-list";
    this.scrollContainers.clear();
    this.scrollContainers.add(this.protectionView);
    this.scrollContainers.add(this.logList);
    this.virtualLogList = new VirtualLogList(
      this.document,
      this.logList,
      (entry) => this.createLogElement(entry),
      MAX_LOG_ENTRIES,
      (callback) => this.controller.runNativeAnimationFrame(callback)
    );
    this.logsView.append(logToolbar, this.logSummary, this.logList);

    this.panel.append(header, tabs, this.protectionView, this.logsView);
    this.root.append(launcher, this.panel);
    this.installScrollGuard();
    if (this.window.ResizeObserver) {
      this.panelResizeObserver = new this.window.ResizeObserver(() => {
        if (!this.panel.hidden) {
          this.saveUiState();
          this.virtualLogList?.scheduleRender({ force: true });
        }
      });
      this.panelResizeObserver.observe(this.panel);
    }
    this.controller.subscribeLogs(this.onLogsChanged);
    this.controller.subscribeState(this.onStateChanged);

    this.masterInput.addEventListener("change", () => {
      this.controller.setEnabled(this.masterInput.checked);
    });
    launcher.addEventListener("click", () => {
      if (this.suppressLauncherClick) {
        this.suppressLauncherClick = false;
        return;
      }
      this.panel.hidden = !this.panel.hidden;
    });
    close.addEventListener("click", () => {
      this.panel.hidden = true;
    });
    this.selectTab("protection");
    this.render();
    this.renderLogs();
    return this.host;
  }

  selectTab(tab) {
    const showingLogs = tab === "logs";
    this.protectionTab.setAttribute("aria-selected", String(!showingLogs));
    this.logsTab.setAttribute("aria-selected", String(showingLogs));
    this.protectionView.hidden = showingLogs;
    this.logsView.hidden = !showingLogs;
    if (showingLogs) this.renderLogs();
  }

  render() {
    const state = this.controller.getState();
    this.masterInput.checked = state.enabled;
    this.captureInput.checked = state.capture;
    this.retainLogsInput.checked = state.retainLogs;
    for (const group of FEATURE_REGISTRY.groups) {
      const inputs = this.groupInputs.get(group.key);
      const allBlock = group.definitions.every(
        (definition) => state.features[definition.key] === MODE_BLOCK
      );
      const allTrace = group.definitions.every(
        (definition) => state.features[definition.key] === MODE_TRACE
      );
      this.applyModeInputs(
        inputs,
        allBlock ? MODE_BLOCK : allTrace ? MODE_TRACE : MODE_OFF,
        state.enabled
      );
    }
    for (const definition of FEATURE_REGISTRY.definitions) {
      const inputs = this.featureInputs.get(definition.key);
      this.applyModeInputs(inputs, state.features[definition.key], state.enabled);
    }
  }

  applyModeInputs(inputs, mode, enabled) {
    inputs.block.checked = mode === MODE_BLOCK;
    inputs.trace.checked = mode === MODE_TRACE;
    inputs.block.disabled = !enabled;
    inputs.trace.disabled = !enabled;
  }

  renderLogs() {
    this.logScheduler.reset();
    const totalCount = this.controller.getLogCount();
    const previousScrollTop = this.logList.scrollTop;
    const logs = [];
    this.controller.forEachLog((entry) => {
      if (!this.logQuery || this.getSearchText(entry).includes(this.logQuery)) logs.push(entry);
    });
    this.updateLogSummary(totalCount, logs.length);
    this.virtualLogList.setItems(logs, this.logQuery ? "No matching logs." : "No logs yet.");
    if (this.followLatest) this.scrollLogsToLatest();
    else this.logList.scrollTop = previousScrollTop;
  }

  handleLogChange(entry) {
    if (!this.logsView || this.logsView.hidden) {
      this.logScheduler.markFullRender();
      return;
    }
    if (!entry || this.logQuery) {
      this.logScheduler.requestFullRender();
      return;
    }
    this.logScheduler.queueEntry(entry);
  }

  appendLogEntries(entries) {
    if (entries.length === 0) {
      this.updateLogSummary(this.controller.getLogCount(), this.virtualLogList.length);
      return;
    }
    const totalCount = this.controller.getLogCount();
    if (this.virtualLogList.length + entries.length > totalCount) {
      this.renderLogs();
      return;
    }
    this.virtualLogList.appendItems(entries);
    if (this.followLatest) this.scrollLogsToLatest();
    this.updateLogSummary(totalCount, totalCount);
  }

  createLogElement(entry) {
    const data = this.getLogViewData(entry);
    const item = this.document.createElement("article");
    item.className = `log-entry ${this.getLogClass(data.type)}`;
    const meta = this.document.createElement("div");
    meta.className = "log-meta";
    const type = this.document.createElement("span");
    type.className = "log-type";
    type.textContent = data.type;
    meta.append(this.document.createTextNode(`${data.time} `), type);
    item.appendChild(meta);
    if (data.payload) {
      const content = this.document.createElement("pre");
      content.className = "log-payload";
      content.textContent = data.payload;
      item.appendChild(content);
    }
    if (data.stack) {
      const stack = this.document.createElement("pre");
      stack.className = "log-stack";
      stack.textContent = data.stack;
      item.appendChild(stack);
    }
    return item;
  }

  getLogViewData(entry) {
    const cached = this.logViewCache.get(entry);
    if (cached) return cached;
    const data = {
      time: entry.time.toLocaleTimeString(),
      type: String(entry.type || ""),
      payload: this.formatPayload(entry.payload),
      stack: String(entry.stack || "")
    };
    this.logViewCache.set(entry, data);
    return data;
  }

  getLogSearchData(entry) {
    const cached = this.logSearchCache.get(entry);
    if (cached) return cached;
    const payload = this.serializePayload(entry.payload, undefined, true);
    const data = {
      text: `${String(entry.type || "")} ${payload}`.toLowerCase(),
      stackText: String(entry.stack || "").toLowerCase()
    };
    this.logSearchCache.set(entry, data);
    return data;
  }

  updateLogSummary(totalCount, visibleCount) {
    this.logsTab.textContent = `Logs (${totalCount})`;
    this.logSummary.textContent = this.logQuery
      ? `Showing ${visibleCount} of ${totalCount} matching logs.`
      : `Showing ${visibleCount} of ${totalCount} logs.`;
  }

  getSearchText(entry) {
    const searchStackOnly = this.searchStackInput.checked && !this.searchTextInput.checked;
    const searchTextOnly = this.searchTextInput.checked && !this.searchStackInput.checked;
    if (searchStackOnly) return String(entry.stack || "").toLowerCase();
    const data = this.getLogSearchData(entry);
    if (searchTextOnly) return data.text;
    return `${data.text} ${data.stackText}`;
  }

  getLogClass(type) {
    if (type.startsWith(`[${MODE_BLOCK}]`)) return "log-blocked";
    if (type.startsWith(`[${MODE_TRACE}]`)) return "log-trace";
    return "log-info";
  }

  scrollLogsToLatest() {
    if (this.virtualLogList) this.virtualLogList.scrollToLatest();
  }

  formatPayload(payload) {
    return this.serializePayload(payload, 2);
  }

  serializePayload(payload, space, fallbackToString = false) {
    if (payload === undefined) return "";
    if (typeof payload === "string") return payload;
    const serialized = JsonValueSerializer.stringify(payload, space);
    return serialized === null
      ? String(payload)
      : serialized || (fallbackToString ? String(payload) : "");
  }

  exportLogs() {
    const records = [];
    this.controller.forEachLog((entry) => records.push({
      time: entry.time,
      type: entry.type,
      payload: entry.payload,
      stack: entry.stack
    }));
    const state = this.controller.getState();
    const exportData = {
      metadata: {
        exportedAt: new Date().toISOString(),
        enabled: state.enabled,
        capture: state.capture,
        retainLogs: state.retainLogs,
        features: { ...state.features }
      },
      logs: records
    };
    const content = JsonValueSerializer.stringify(exportData, 2) || "{\"metadata\":{},\"logs\":[]}";
    const blob = new this.window.Blob([content], { type: "application/json" });
    const url = this.window.URL.createObjectURL(blob);
    const link = this.document.createElement("a");
    link.href = url;
    link.download = `JS_WebUtils-${Date.now()}.json`;
    link.click();
    this.controller.runNativeTimeout(() => this.window.URL.revokeObjectURL(url), 0);
  }

  startDrag(event, source) {
    const rect = this.host.getBoundingClientRect();
    this.dragState = {
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    this.host.style.left = `${rect.left}px`;
    this.host.style.top = `${rect.top}px`;
    this.host.style.right = "auto";
    this.document.addEventListener("pointermove", this.onPointerMove);
    this.document.addEventListener("pointerup", this.onPointerEnd, { once: true });
    this.document.addEventListener("pointercancel", this.onPointerEnd, { once: true });
    if (source === "panel") event.preventDefault();
  }

  moveDrag(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    const deltaX = event.clientX - this.dragState.startX;
    const deltaY = event.clientY - this.dragState.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) this.dragState.moved = true;
    this.host.style.left = `${this.dragState.left + deltaX}px`;
    this.host.style.top = `${this.dragState.top + deltaY}px`;
  }

  endDrag() {
    const state = this.dragState;
    this.dragState = null;
    if (state?.source === "launcher" && state.moved) this.suppressLauncherClick = true;
    this.saveUiState();
    this.document.removeEventListener("pointermove", this.onPointerMove);
    this.document.removeEventListener("pointerup", this.onPointerEnd);
    this.document.removeEventListener("pointercancel", this.onPointerEnd);
  }
}

