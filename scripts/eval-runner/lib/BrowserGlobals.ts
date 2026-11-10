/**
 * Browser Globals Shim for Node.js
 *
 * Sets up minimal browser global stubs needed to import DevTools code
 * in a Node.js environment. Must be imported before any DevTools imports.
 */

// Only apply if we're in Node.js (not browser)
if (typeof window === 'undefined') {
  // Minimal location shim
  (globalThis as any).location = {
    hostname: 'localhost',
    port: '',
    search: '',
    href: 'http://localhost/',
    protocol: 'http:',
    origin: 'http://localhost',
    pathname: '/',
    hash: '',
  };

  // Minimal window shim
  (globalThis as any).window = globalThis;

  // Node shim for DOM tree
  class NodeShim {
    childNodes: NodeShim[] = [];
    parentNode: NodeShim | null = null;
    nextSibling: NodeShim | null = null;
    previousSibling: NodeShim | null = null;
    nodeType = 1;
    nodeName = '';
    textContent = '';
    data = '';

    appendChild(child: NodeShim) {
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    }
    insertBefore(newNode: NodeShim, _refNode: NodeShim | null) {
      this.childNodes.push(newNode);
      return newNode;
    }
    removeChild(child: NodeShim) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) this.childNodes.splice(idx, 1);
      return child;
    }
    replaceWith(...nodes: NodeShim[]) {}
    remove() {}
    cloneNode() { return new NodeShim(); }
  }
  (globalThis as any).Node = NodeShim;

  // Comment node shim
  class CommentShim extends NodeShim {
    nodeType = 8;
    constructor() {
      super();
      this.nodeName = '#comment';
    }
  }

  // Text node shim
  class TextShim extends NodeShim {
    nodeType = 3;
    constructor(text = '') {
      super();
      this.textContent = text;
      this.nodeName = '#text';
    }
  }

  // Element shim
  class ElementShim extends NodeShim {
    nodeType = 1;
    attributes: Map<string, string> = new Map();
    classList = { add: () => {}, remove: () => {}, contains: () => false };
    innerHTML = '';

    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    removeAttribute(name: string) { this.attributes.delete(name); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    getAttributeNames() { return Array.from(this.attributes.keys()); }
    hasAttributes() { return this.attributes.size > 0; }
    toggleAttribute(name: string, force?: boolean) {
      if (force === undefined) force = !this.hasAttribute(name);
      if (force) this.setAttribute(name, ''); else this.removeAttribute(name);
      return force;
    }
    append(...nodes: any[]) {}
    get content() { return this; }
    get firstChild() { return this.childNodes[0] || null; }
  }

  // Template element shim
  class TemplateShim extends ElementShim {
    content = new ElementShim();
  }

  // TreeWalker shim
  class TreeWalkerShim {
    currentNode: any = null;
    nextNode() { return null; }
  }

  // Document class shim for Lit compatibility
  class DocumentShim extends NodeShim {
    body = new ElementShim();
    head = new ElementShim();
    documentElement = new ElementShim();
    adoptedStyleSheets: any[] = [];

    createElement(tag: string) {
      if (tag === 'template') return new TemplateShim();
      const el = new ElementShim();
      el.nodeName = tag.toUpperCase();
      return el;
    }
    createComment(data?: string) {
      const c = new CommentShim();
      c.data = data || '';
      return c;
    }
    createTextNode(text: string) { return new TextShim(text); }
    createTreeWalker() { return new TreeWalkerShim(); }
    importNode(node: any) { return node; }
  }

  // Add adoptedStyleSheets to Document.prototype for Lit check
  (globalThis as any).Document = DocumentShim;
  Object.defineProperty(DocumentShim.prototype, 'adoptedStyleSheets', {
    value: [],
    writable: true,
  });

  // Minimal document shim instance
  (globalThis as any).document = new DocumentShim();

  // Minimal localStorage shim
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    get length() {
      return storage.size;
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
  };

  // Minimal sessionStorage shim
  const sessionStore = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => sessionStore.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStore.set(key, value),
    removeItem: (key: string) => sessionStore.delete(key),
    clear: () => sessionStore.clear(),
    get length() {
      return sessionStore.size;
    },
    key: (index: number) => Array.from(sessionStore.keys())[index] ?? null,
  };

  // CustomEvent shim
  (globalThis as any).CustomEvent = class CustomEvent extends Event {
    detail: any;
    constructor(type: string, options?: { detail?: any }) {
      super(type);
      this.detail = options?.detail;
    }
  };

  // HTMLElement shim for Lit compatibility
  // This is a minimal stub that allows Lit to load without crashing
  // Lit components won't work, but we don't need them in Node.js
  (globalThis as any).HTMLElement = class HTMLElement {
    attachShadow() { return {}; }
    setAttribute() {}
    getAttribute() { return null; }
    removeAttribute() {}
    hasAttribute() { return false; }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
    connectedCallback() {}
    disconnectedCallback() {}
    attributeChangedCallback() {}
  };

  // CSSStyleSheet shim for Lit
  (globalThis as any).CSSStyleSheet = class CSSStyleSheet {
    replaceSync() {}
    replace() { return Promise.resolve(this); }
  };

  // ShadowRoot shim
  (globalThis as any).ShadowRoot = class ShadowRoot {};

  console.log('[BrowserGlobals] Browser globals shimmed for Node.js environment');
}

export {};
