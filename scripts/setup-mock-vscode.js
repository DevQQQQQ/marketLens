// scripts/setup-mock-vscode.js
const fs = require('fs');
const path = require('path');

const rootPkgPath = path.resolve(__dirname, '..', 'package.json');
let extVersion = "1.2.2";
try {
  extVersion = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')).version || "1.2.2";
} catch (_) {}

const targetDir = path.resolve(__dirname, '..', 'node_modules', 'vscode');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const packageJson = {
  name: "vscode",
  version: "1.85.0",
  main: "index.cjs",
  module: "index.mjs",
  exports: {
    import: "./index.mjs",
    require: "./index.cjs"
  }
};

fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');

const cjsContent = `
const mockConfigStore = new Map();
const mockCommandStore = new Map();

const mockFiles = new Map();
let lastDialogUri = { fsPath: "/mock/backup.json", path: "/mock/backup.json", scheme: "file", toString: () => "/mock/backup.json" };

function __resetMock() {
  mockConfigStore.clear();
  mockCommandStore.clear();
  mockFiles.clear();
  lastDialogUri = { fsPath: "/mock/backup.json", path: "/mock/backup.json", scheme: "file", toString: () => "/mock/backup.json" };
}

function __setMockConfiguration(key, value) {
  mockConfigStore.set(key, value);
}

function __getMockConfiguration(key) {
  return mockConfigStore.get(key);
}

function __setMockFile(path, content) {
  mockFiles.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content));
}

function __getMockFile(path) {
  return mockFiles.get(path);
}

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
};

const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2
};

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
};

class TreeItem {
  constructor(label, collapsibleState = TreeItemCollapsibleState.None) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

class MarkdownString {
  constructor(value = "", supportThemeIcons = false) {
    this.value = value;
    this.isTrusted = false;
    this.supportThemeIcons = supportThemeIcons;
  }
  appendMarkdown(value) {
    this.value += value;
    return this;
  }
  appendText(value) {
    this.value += value;
    return this;
  }
}

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx !== -1) this.listeners.splice(idx, 1);
      }};
    };
  }
  fire(data) {
    for (const listener of [...this.listeners]) {
      try { listener(data); } catch (_) {}
    }
  }
  dispose() {
    this.listeners = [];
  }
}

class Disposable {
  constructor(call) {
    this._call = call || (() => {});
  }
  dispose() {
    if (this._call) {
      this._call();
      this._call = null;
    }
  }
  static from(...disposables) {
    return new Disposable(() => {
      for (const d of disposables) {
        if (d && typeof d.dispose === 'function') d.dispose();
      }
    });
  }
}

const Uri = {
  file(f) {
    return { fsPath: f, path: f, scheme: "file", toString: () => f };
  },
  parse(u) {
    return { fsPath: u, path: u, scheme: "http", toString: () => u };
  }
};

const workspace = {
  workspaceFolders: [],
  fs: {
    async readFile(uri) {
      const p = uri.fsPath || uri.path || uri.toString();
      if (mockFiles.has(p)) {
        return mockFiles.get(p);
      }
      return fs.readFileSync(p);
    },
    async writeFile(uri, content) {
      const p = uri.fsPath || uri.path || uri.toString();
      mockFiles.set(p, Buffer.from(content));
    }
  },
  onDidChangeConfiguration(listener) {
    return new Disposable();
  },
  getConfiguration(section = "") {
    return {
      get(key, defaultValue) {
        const fullKey = section ? (section + "." + key) : key;
        if (mockConfigStore.has(fullKey)) {
          return mockConfigStore.get(fullKey);
        }
        if (mockConfigStore.has(key)) {
          return mockConfigStore.get(key);
        }
        return defaultValue;
      },
      async update(key, value, target) {
        const fullKey = section ? (section + "." + key) : key;
        if (value === undefined) {
          mockConfigStore.delete(fullKey);
          mockConfigStore.delete(key);
        } else {
          mockConfigStore.set(fullKey, value);
          mockConfigStore.set(key, value);
        }
      },
      inspect(key) {
        const fullKey = section ? (section + "." + key) : key;
        const val = mockConfigStore.get(fullKey) ?? mockConfigStore.get(key);
        return {
          key: fullKey,
          globalValue: val,
          defaultValue: undefined
        };
      }
    };
  }
};

const window = {
  async showInformationMessage(msg) { return undefined; },
  async showWarningMessage(msg, options, ...items) {
    if (items && items.length > 0) {
      return items[0];
    }
    return undefined;
  },
  async showErrorMessage(msg) { return undefined; },
  async showQuickPick(items) { return undefined; },
  createQuickPick() {
    const qp = {
      title: "",
      placeholder: "",
      items: [],
      selectedItems: [],
      activeItems: [],
      value: "",
      busy: false,
      enabled: true,
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
      _validateInput: undefined,
      _onDidAccept: new EventEmitter(),
      _onDidChangeValue: new EventEmitter(),
      _onDidHide: new EventEmitter(),
      _onDidChangeActive: new EventEmitter(),
      _onDidChangeSelection: new EventEmitter(),
      get onDidAccept() { return this._onDidAccept.event; },
      get onDidChangeValue() { return this._onDidChangeValue.event; },
      get onDidHide() { return this._onDidHide.event; },
      get onDidChangeActive() { return this._onDidChangeActive.event; },
      get onDidChangeSelection() { return this._onDidChangeSelection.event; },
      show() {
        if (typeof window.showInputBox === "function") {
          Promise.resolve().then(async () => {
            const inputVal = await window.showInputBox({
              prompt: "输入股票代码 / 币对 / 合约地址",
              validateInput: (v) => qp._validateInput ? qp._validateInput(v) : undefined
            });
            if (inputVal !== undefined) {
              qp.value = inputVal;
              qp._onDidChangeValue.fire(inputVal);
              qp._onDidAccept.fire();
            } else {
              qp._onDidHide.fire();
            }
          });
        }
      },
      hide() { this._onDidHide.fire(); },
      dispose() {
        this._onDidAccept.dispose();
        this._onDidChangeValue.dispose();
        this._onDidHide.dispose();
        this._onDidChangeActive.dispose();
        this._onDidChangeSelection.dispose();
      }
    };
    return qp;
  },
  async showInputBox(options) { return undefined; },
  async showSaveDialog(options) {
    lastDialogUri = options?.defaultUri || Uri.file("/mock/backup.json");
    return lastDialogUri;
  },
  async showOpenDialog(options) {
    return [lastDialogUri];
  },
  setStatusBarMessage(msg, timeout) { return new Disposable(); },
  createStatusBarItem(alignment, priority) {
    return {
      text: "",
      tooltip: "",
      command: undefined,
      color: undefined,
      backgroundColor: undefined,
      show() {},
      hide() {},
      dispose() {}
    };
  },
  createTreeView(viewId, options) {
    return {
      onDidChangeVisibility() { return new Disposable(); },
      dispose() {}
    };
  },
  createOutputChannel(name) {
    return {
      append(val) {},
      appendLine(val) {},
      clear() {},
      show() {},
      hide() {},
      dispose() {}
    };
  },
  createWebviewPanel(viewType, title, showOptions, options) {
    const listeners = [];
    const disposeListeners = [];
    return {
      webview: {
        html: "",
        options: options || {},
        onDidReceiveMessage(listener) {
          listeners.push(listener);
          return new Disposable(() => {
            const idx = listeners.indexOf(listener);
            if (idx !== -1) listeners.splice(idx, 1);
          });
        },
        async postMessage(msg) {
          return true;
        },
        asWebviewUri(uri) {
          return uri;
        }
      },
      reveal() {},
      onDidChangeViewState(listener) {
        return new Disposable();
      },
      onDidDispose(listener) {
        disposeListeners.push(listener);
        return new Disposable();
      },
      dispose() {
        for (const l of disposeListeners) {
          try { l(); } catch (_) {}
        }
      }
    };
  }
};

const commands = {
  registerCommand(cmd, handler) {
    mockCommandStore.set(cmd, handler);
    return new Disposable(() => mockCommandStore.delete(cmd));
  },
  async executeCommand(cmd, ...args) {
    const handler = mockCommandStore.get(cmd);
    if (handler) {
      return await handler(...args);
    }
    return undefined;
  }
};

const extensions = {
  getExtension(id) {
    return {
      packageJSON: { version: "${extVersion}" }
    };
  }
};

const env = {
  openExternal: async () => true,
  clipboard: {
    writeText: async () => {},
    readText: async () => ""
  }
};

module.exports = {
  ConfigurationTarget,
  ViewColumn,
  StatusBarAlignment,
  TreeItemCollapsibleState,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  MarkdownString,
  EventEmitter,
  Disposable,
  Uri,
  workspace,
  window,
  commands,
  extensions,
  env,
  __resetMock,
  __setMockConfiguration,
  __getMockConfiguration,
  __setMockFile,
  __getMockFile
};
`;

const mjsContent = `
import cjs from "./index.cjs";

export const ConfigurationTarget = cjs.ConfigurationTarget;
export const ViewColumn = cjs.ViewColumn;
export const StatusBarAlignment = cjs.StatusBarAlignment;
export const TreeItemCollapsibleState = cjs.TreeItemCollapsibleState;
export const TreeItem = cjs.TreeItem;
export const ThemeIcon = cjs.ThemeIcon;
export const ThemeColor = cjs.ThemeColor;
export const MarkdownString = cjs.MarkdownString;
export const EventEmitter = cjs.EventEmitter;
export const Disposable = cjs.Disposable;
export const Uri = cjs.Uri;
export const workspace = cjs.workspace;
export const window = cjs.window;
export const commands = cjs.commands;
export const extensions = cjs.extensions;
export const env = cjs.env;
export const __resetMock = cjs.__resetMock;
export const __setMockConfiguration = cjs.__setMockConfiguration;
export const __getMockConfiguration = cjs.__getMockConfiguration;
export const __setMockFile = cjs.__setMockFile;
export const __getMockFile = cjs.__getMockFile;

export default cjs;
`;

fs.writeFileSync(path.join(targetDir, 'index.cjs'), cjsContent.trim(), 'utf8');
fs.writeFileSync(path.join(targetDir, 'index.mjs'), mjsContent.trim(), 'utf8');

console.log('[MarketLens] Mock vscode module setup complete at:', targetDir);
