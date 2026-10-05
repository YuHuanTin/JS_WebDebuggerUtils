import { ProtectionCore } from "./protection-core.js";
import { UtilsUi } from "./ui.js";

export class UserscriptApp {
  constructor(globalWindow, globalDocument) {
    this.window = globalWindow;
    this.core = new ProtectionCore(globalWindow, globalDocument);
    this.ui = new UtilsUi(globalWindow, globalDocument, this.core);
  }

  start() {
    this.core.start();
    if (this.window.top === this.window) this.ui.mountWhenReady();
  }
}

