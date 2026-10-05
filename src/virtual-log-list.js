import { FenwickTree } from "./fenwick-tree.js";

export class VirtualLogList {
  constructor(globalDocument, host, createItem, maxEntries, runAnimationFrame) {
    this.document = globalDocument;
    this.host = host;
    this.createItem = createItem;
    this.runAnimationFrame = runAnimationFrame;
    this.items = [];
    this.heightCache = new WeakMap();
    this.tree = new FenwickTree(maxEntries);
    this.estimatedHeight = 128;
    this.rowGap = 7;
    this.overscan = 640;
    this.emptyText = "No logs yet.";
    this.renderFrame = 0;
    this.forceRender = false;
    this.renderedStart = -1;
    this.renderedEnd = -1;
    this.topSpacer = this.document.createElement("div");
    this.bottomSpacer = this.document.createElement("div");
    this.windowElement = this.document.createElement("div");
    this.topSpacer.className = "log-spacer";
    this.bottomSpacer.className = "log-spacer";
    this.windowElement.className = "log-window";
    this.host.addEventListener("scroll", () => this.scheduleRender(), { passive: true });
  }

  get length() {
    return this.items.length;
  }

  setItems(items, emptyText) {
    this.items = items;
    if (emptyText !== undefined) this.emptyText = emptyText;
    this.tree.build(items.length, (index) => this.getHeight(items[index]));
    this.renderedStart = -1;
    this.renderedEnd = -1;
    this.host.replaceChildren(this.topSpacer, this.windowElement, this.bottomSpacer);
    this.render({ force: true });
  }

  appendItems(items) {
    if (items.length === 0) return;
    const start = this.items.length;
    this.items.push(...items);
    for (let index = start; index < this.items.length; index++) {
      this.tree.size = index + 1;
      this.tree.add(index, this.getHeight(this.items[index]));
    }
    this.render({ force: true });
  }

  scrollToLatest() {
    this.host.scrollTop = this.host.scrollHeight;
    this.scheduleRender({ force: true });
  }

  getHeight(entry) {
    return this.heightCache.get(entry) || this.estimatedHeight;
  }

  scheduleRender({ force = false } = {}) {
    this.forceRender = this.forceRender || force;
    if (this.renderFrame) return;
    this.renderFrame = this.runAnimationFrame(() => {
      const shouldForce = this.forceRender;
      this.renderFrame = 0;
      this.forceRender = false;
      this.render({ force: shouldForce });
    });
  }

  render({ force = false } = {}) {
    if (this.items.length === 0) {
      const empty = this.document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = this.emptyText;
      this.host.replaceChildren(empty);
      this.renderedStart = -1;
      this.renderedEnd = -1;
      return;
    }
    if (!this.host.contains(this.topSpacer)) {
      this.host.replaceChildren(this.topSpacer, this.windowElement, this.bottomSpacer);
    }
    const viewportHeight = Math.max(this.host.clientHeight, 1);
    const scrollTop = this.host.scrollTop;
    const start = Math.max(0, this.tree.lowerBound(Math.max(0, scrollTop - this.overscan)));
    const end = Math.min(
      this.items.length,
      this.tree.lowerBound(scrollTop + viewportHeight + this.overscan) + 1
    );
    this.updateSpacers(start, end);
    if (!force && start === this.renderedStart && end === this.renderedEnd) return;

    const anchorIndex = this.tree.lowerBound(scrollTop);
    const fragment = this.document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      fragment.appendChild(this.createItem(this.items[index]));
    }
    this.windowElement.replaceChildren(fragment);
    this.renderedStart = start;
    this.renderedEnd = end;

    let anchorDelta = 0;
    for (let offset = 0; offset < this.windowElement.children.length; offset++) {
      const index = start + offset;
      const entry = this.items[index];
      const measured = this.windowElement.children[offset].offsetHeight + this.rowGap;
      if (!measured) continue;
      const previous = this.tree.valueAt(index);
      const delta = measured - previous;
      if (Math.abs(delta) < 0.5) continue;
      this.heightCache.set(entry, measured);
      this.tree.add(index, delta);
      if (index < anchorIndex) anchorDelta += delta;
    }
    if (anchorDelta) this.host.scrollTop += anchorDelta;
    this.updateSpacers(start, end);
  }

  updateSpacers(start, end) {
    const totalHeight = this.tree.sum();
    this.topSpacer.style.height = this.tree.sum(start) + "px";
    this.bottomSpacer.style.height = Math.max(0, totalHeight - this.tree.sum(end)) + "px";
  }
}

