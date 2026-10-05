export class LogRenderScheduler {
  constructor({ runAnimationFrame, runTimeout, cancelTimeout, isVisible, renderAll, appendEntries }) {
    this.runAnimationFrame = runAnimationFrame;
    this.runTimeout = runTimeout;
    this.cancelTimeout = cancelTimeout;
    this.isVisible = isVisible;
    this.renderAll = renderAll;
    this.appendEntries = appendEntries;
    this.renderFrame = 0;
    this.searchTimer = 0;
    this.fullRenderPending = false;
    this.pendingEntries = [];
  }

  queueEntry(entry) {
    this.pendingEntries.push(entry);
    this.scheduleFrame();
  }

  markFullRender() {
    this.fullRenderPending = true;
    this.pendingEntries = [];
  }

  requestFullRender() {
    this.cancelSearch();
    this.markFullRender();
    this.scheduleFrame();
  }

  scheduleSearch(query) {
    this.cancelSearch();
    if (!query) {
      this.requestFullRender();
      return;
    }
    this.searchTimer = this.runTimeout(() => {
      this.searchTimer = 0;
      this.requestFullRender();
    }, 120);
  }

  reset() {
    this.cancelSearch();
    this.fullRenderPending = false;
    this.pendingEntries = [];
  }

  cancelSearch() {
    if (!this.searchTimer) return;
    this.cancelTimeout(this.searchTimer);
    this.searchTimer = 0;
  }

  scheduleFrame() {
    if (this.renderFrame) return;
    this.renderFrame = this.runAnimationFrame(() => {
      this.renderFrame = 0;
      if (!this.isVisible()) return;
      if (this.fullRenderPending) {
        this.fullRenderPending = false;
        this.pendingEntries = [];
        this.renderAll();
        return;
      }
      if (this.pendingEntries.length === 0) return;
      const entries = this.pendingEntries;
      this.pendingEntries = [];
      this.appendEntries(entries);
    });
  }
}

