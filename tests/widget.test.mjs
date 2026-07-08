import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(join(process.cwd(), "tinycart.js"), "utf8");

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(name) {
    const names = new Set((this.element.className || "").split(/\s+/).filter(Boolean));
    names.add(name);
    this.element.className = Array.from(names).join(" ");
  }

  remove(name) {
    const names = (this.element.className || "").split(/\s+/).filter((candidate) => candidate && candidate !== name);
    this.element.className = names.join(" ");
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.required = false;
    this.type = "";
    this.name = "";
    this.id = "";
    this.rows = 0;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === "id") this.id = text;
    if (name === "name") this.name = text;
    if (name === "type") this.type = text;
    if (name === "class") this.className = text;
  }

  getAttribute(name) {
    if (name === "id" && this.id) return this.id;
    if (name === "name" && this.name) return this.name;
    if (name === "type" && this.type) return this.type;
    if (name === "class" && this.className) return this.className;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, this.listeners.get(type) || []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== handler));
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    (this.listeners.get(event.type) || []).slice().forEach((handler) => handler.call(this, event));
    return !event.defaultPrevented;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  reportValidity() {
    return this.querySelectorAll("input,textarea").every((input) => !input.required || String(input.value || "").trim() !== "");
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const matches = [];
    walk(this, (node) => {
      if (node !== this && selectors.some((part) => matchesSelector(node, part))) {
        matches.push(node);
      }
    });
    return matches;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  get offsetParent() {
    return this.parentNode;
  }
}

class FakeDocument extends FakeElement {
  constructor(config = {}) {
    super("#document", null);
    this.ownerDocument = this;
    this.readyState = "complete";
    this.activeElement = null;
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.scripts = [];
    this.currentScript = null;
    this.append(this.head, this.body);

    if (config.scriptConfig) {
      const script = this.createElement("script");
      script.setAttribute("data-tc-config", JSON.stringify(config.scriptConfig));
      this.currentScript = script;
      this.scripts.push(script);
    }
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    let found = null;
    walk(this, (node) => {
      if (!found && node.id === id) found = node;
    });
    return found;
  }
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.key = options.key || "";
    this.shiftKey = !!options.shiftKey;
    this.defaultPrevented = false;
    this.target = options.target || null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail || {};
  }
}

class FakeFormData {
  constructor(form) {
    this.fields = new Map();
    form.querySelectorAll("input,textarea").forEach((input) => {
      if ((input.type || "").toLowerCase() === "radio" && !input.checked) return;
      if (input.name) this.fields.set(input.name, input.value || "");
    });
  }

  get(name) {
    return this.fields.get(name) || "";
  }
}

function walk(node, visit) {
  node.children.forEach((child) => {
    visit(child);
    walk(child, visit);
  });
}

function matchesSelector(node, selector) {
  if (selector === "[tabindex]:not([tabindex='-1'])") {
    return node.hasAttribute("tabindex") && node.getAttribute("tabindex") !== "-1";
  }
  if (selector.startsWith(".")) {
    return (node.className || "").split(/\s+/).includes(selector.slice(1));
  }
  const attrOnly = selector.match(/^\[([^=\]]+)="([^"]+)"\]$/);
  if (attrOnly) {
    return node.getAttribute(attrOnly[1]) === attrOnly[2];
  }
  const tagAttr = selector.match(/^([a-z]+)\[([^=\]]+)="([^"]+)"\]$/i);
  if (tagAttr) {
    return node.tagName.toLowerCase() === tagAttr[1].toLowerCase() && node.getAttribute(tagAttr[2]) === tagAttr[3];
  }
  const dataAttrs = selector.match(/^\[data-tc-id\]\[data-tc-name\]\[data-tc-price\]$/);
  if (dataAttrs) {
    return node.hasAttribute("data-tc-id") && node.hasAttribute("data-tc-name") && node.hasAttribute("data-tc-price");
  }
  if (selector === "[data-tc-id]") {
    return node.hasAttribute("data-tc-id");
  }
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function createStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function createHarness({ scriptConfig = {}, fetch, storage = createStorage() } = {}) {
  const document = new FakeDocument({ scriptConfig });
  const window = {
    document,
    localStorage: storage,
    location: { href: "http://127.0.0.1:8000/sample.html", assign() {} },
    navigator: { sendBeacon: () => false },
    fetch,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
  const context = vm.createContext({
    window,
    document,
    navigator: window.navigator,
    console,
    CustomEvent: FakeCustomEvent,
    FormData: FakeFormData,
    Blob: class FakeBlob {},
    setTimeout,
    clearTimeout,
    Intl,
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Error,
    Promise
  });

  vm.runInContext(source, context, { filename: "tinycart.js" });
  return { window, document };
}

function fillCheckoutForm(document) {
  document.querySelector('[name="name"]').value = "Ada Lovelace";
  document.querySelector('[name="phone"]').value = "+15551234567";
  document.querySelector('[name="email"]').value = "ada@example.com";
  document.querySelector('[name="address"]').value = "1 Byte Lane";
}

async function flushAsync() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("announces cart count changes with a polite live region", () => {
  const { window, document } = createHarness();
  const count = document.querySelector(".tc-count");

  assert.equal(count.getAttribute("aria-live"), "polite");
  assert.equal(count.getAttribute("aria-atomic"), "true");

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  assert.equal(count.textContent, "1");
});

test("falls back when accent color is too low contrast for white button text", () => {
  const { document } = createHarness({ scriptConfig: { accent: "#ffffff" } });
  const root = document.querySelector(".tc-root");

  assert.equal(root.style.getPropertyValue("--tc-accent"), "#111111");
});

test("theme tokens are host-overridable and scoped to TinyCart", () => {
  const { document } = createHarness();
  const root = document.querySelector(".tc-root");
  const css = document.getElementById("tinycart-style").textContent;

  assert.equal(root.style.getPropertyValue("--tc-accent"), "");
  assert.match(css, /--tc-accent:#111/);
  assert.match(css, /var\(--tc-accent\)/);
  assert.match(css, /--tc-radius:10px/);
  assert.match(css, /var\(--tc-radius\)/);
  assert.match(css, /--tc-font:system-ui/);
  assert.match(css, /prefers-color-scheme:dark/);
  assert.doesNotMatch(css, /(^|\n)\s*(body|button|input|textarea)\b/);
});

test("traps focus while open and restores the opener on Escape", () => {
  const { document } = createHarness();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  document.querySelector(".tc-float").dispatchEvent(new FakeEvent("click"));
  const modal = document.querySelector(".tc-backdrop");
  const focusable = modal.querySelectorAll("button,input,textarea,[href],[tabindex]:not([tabindex='-1'])");
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  assert.equal(modal.getAttribute("aria-hidden"), "false");
  assert.equal(document.activeElement, first);

  last.focus();
  document.dispatchEvent(new FakeEvent("keydown", { key: "Tab" }));
  assert.equal(document.activeElement, first);

  first.focus();
  document.dispatchEvent(new FakeEvent("keydown", { key: "Tab", shiftKey: true }));
  assert.equal(document.activeElement, last);

  document.dispatchEvent(new FakeEvent("keydown", { key: "Escape" }));
  assert.equal(modal.getAttribute("aria-hidden"), "true");
  assert.equal(document.activeElement, opener);
});

test("calculates cart totals, percent coupons, and fixed coupons", async () => {
  const { window, document } = createHarness({
    scriptConfig: {
      coupons: { SAVE10: { type: "percent", value: 10 } }
    }
  });

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 2 });
  window.tinycart.add({ id: "sticker-001", name: "Sticker Pack", price: "7.00", qty: 1 });
  assert.equal(window.tinycart.getCart().totals.subtotalCents, 5500);
  assert.equal(window.tinycart.getCart().totals.totalCents, 5500);

  await window.tinycart.applyCoupon("SAVE10");
  assert.equal(window.tinycart.getCart().coupon.code, "SAVE10");
  assert.equal(window.tinycart.getCart().totals.discountCents, 550);
  assert.equal(window.tinycart.getCart().totals.totalCents, 4950);
  assert.equal(document.querySelector(".tc-coupon-status").textContent, "SAVE10 applied.");

  window.tinycart.init({
    coupons: { FIVE: { type: "fixed", value: 5 } }
  });
  window.tinycart.clear();
  window.tinycart.add({ id: "mug-001", name: "Checkout Mug", price: "18.00", qty: 1 });
  await window.tinycart.applyCoupon("FIVE");
  assert.equal(window.tinycart.getCart().totals.discountCents, 500);
  assert.equal(window.tinycart.getCart().totals.totalCents, 1300);
});

test("stock caps clamp add and update quantities", () => {
  const { window } = createHarness();

  window.tinycart.add({ id: "sticker-001", name: "Sticker Pack", price: "7.00", qty: 5, stock: 3 });
  const item = window.tinycart.getCart().items[0];
  assert.equal(item.qty, 3);
  assert.equal(window.tinycart.getCart().totals.subtotalCents, 2100);

  window.tinycart.update(item.key, { qty: 99 });
  assert.equal(window.tinycart.getCart().items[0].qty, 3);
});

test("safeTemplate escapes values and rejects template tags", () => {
  const { window } = createHarness();

  assert.equal(
    window.tinycart.safeTemplate("Option: {{value}}", { value: "<script>alert(1)</script>" }),
    "Option: &lt;script&gt;alert(1)&lt;/script&gt;"
  );
  assert.throws(
    () => window.tinycart.safeTemplate("<strong>{{value}}</strong>", { value: "bad" }),
    /cannot contain tags/
  );
});

test("formats currency with the configured locale", async () => {
  const eur = createHarness({
    scriptConfig: {
      currency: "EUR",
      locale: "de-DE"
    }
  });

  eur.window.tinycart.add({ id: "mug-001", name: "Checkout Mug", price: "1234.56", qty: 1 });
  assert.equal(eur.window.tinycart.getCart().totals.totalCents, 123456);
  assert.match(eur.document.querySelector(".tc-modal-total").textContent, /1\.234,56\s?€/);

  const jpy = createHarness({
    scriptConfig: {
      currency: "JPY",
      locale: "ja-JP"
    }
  });
  jpy.window.tinycart.add({ id: "sticker-001", name: "Sticker Pack", price: "1234.00", qty: 1 });
  assert.match(jpy.document.querySelector(".tc-modal-total").textContent, /￥1,234|¥1,234/);
});

test("overrides visible widget strings through config", async () => {
  const { window, document } = createHarness({
    scriptConfig: {
      coupons: { SAVE10: { type: "percent", value: 10 } },
      strings: {
        cart: "Bag",
        openCart: "Open bag",
        title: "Your bag",
        coupon: "Promo",
        apply: "Use",
        checkout: "Send order",
        processing: "Sending...",
        empty: "Bag empty",
        remove: "Delete",
        itemAdded: "{{name}} packed",
        couponApplied: "{{code}} ready.",
        couponRemoved: "Promo cleared.",
        name: "Full name",
        required: "Fill the required fields."
      }
    }
  });

  assert.equal(document.querySelector(".tc-float").getAttribute("aria-label"), "Open bag");
  assert.equal(document.querySelector(".tc-float").children[0].textContent, "Bag");
  assert.equal(document.querySelector(".tc-title").textContent, "Your bag");
  assert.equal(document.querySelector(".tc-input").placeholder, "Promo");
  assert.equal(document.querySelector(".tc-coupon").querySelector("button").textContent, "Use");
  assert.equal(document.querySelector('button[form="tc-checkout-form"]').textContent, "Send order");
  assert.equal(document.querySelector(".tc-empty").textContent, "Bag empty");
  assert.equal(document.querySelector('[name="name"]').parentNode.querySelector("span").textContent, "Full name");

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  assert.equal(document.querySelector(".tc-toast").textContent, "TinyCart Tee packed");
  assert.equal(document.querySelector(".tc-remove").textContent, "Delete");

  await window.tinycart.applyCoupon("SAVE10");
  assert.equal(document.querySelector(".tc-coupon-status").textContent, "SAVE10 ready.");

  await window.tinycart.applyCoupon("");
  assert.equal(document.querySelector(".tc-coupon-status").textContent, "Promo cleared.");

  document.querySelector('[name="name"]').value = "";
  document.querySelector('[name="phone"]').value = "+15551234567";
  document.querySelector('[name="address"]').value = "1 Byte Lane";
  document.querySelector(".tc-form").dispatchEvent(new FakeEvent("submit"));
  assert.equal(document.querySelector(".tc-error").textContent, "Fill the required fields.");
  assert.notEqual(document.querySelector(".tc-toast").textContent, "Fill the required fields.");
});

test("catalogUrl hydrates product truth and disables out-of-stock buttons", async () => {
  const { window, document } = createHarness({
    fetch: async () => ({
      ok: true,
      json: async () => ({
        items: [
          { id: "tee-001", name: "Server Tee", price_cents: 2400, currency: "USD", stock: 4 },
          { id: "mug-001", name: "Server Mug", price_cents: 1800, currency: "USD", stock: 0 }
        ]
      })
    })
  });
  const tee = document.createElement("button");
  tee.setAttribute("data-tc-id", "tee-001");
  tee.setAttribute("data-tc-name", "Stale Tee");
  tee.setAttribute("data-tc-price", "1.00");
  const mug = document.createElement("button");
  mug.setAttribute("data-tc-id", "mug-001");
  mug.setAttribute("data-tc-name", "Stale Mug");
  mug.setAttribute("data-tc-price", "1.00");
  document.body.append(tee, mug);

  window.tinycart.init({ catalogUrl: "/catalog.php" });
  await flushAsync();

  assert.equal(mug.disabled, true);
  assert.equal(mug.getAttribute("aria-disabled"), "true");

  document.dispatchEvent(new FakeEvent("click", { target: tee }));
  const item = window.tinycart.getCart().items[0];
  assert.equal(item.name, "Server Tee");
  assert.equal(item.priceCents, 2400);
  assert.equal(item.stock, 4);
});

test("renders sanitized product thumbnails without sending image URLs", async () => {
  let checkoutPayload;
  const { document } = createHarness({
    fetch: async (_url, options) => {
      checkoutPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, order_id: "TIMG1", pay_url: null })
      };
    }
  });
  const good = document.createElement("button");
  good.setAttribute("data-tc-id", "tee-img");
  good.setAttribute("data-tc-name", "Image Tee");
  good.setAttribute("data-tc-price", "24.00");
  good.setAttribute("data-tc-img", "images/tee.svg");
  const scriptUrl = document.createElement("button");
  scriptUrl.setAttribute("data-tc-id", "bad-js");
  scriptUrl.setAttribute("data-tc-name", "Bad JS");
  scriptUrl.setAttribute("data-tc-price", "1.00");
  scriptUrl.setAttribute("data-tc-img", "javascript:alert(1)");
  const dataUrl = document.createElement("button");
  dataUrl.setAttribute("data-tc-id", "bad-data");
  dataUrl.setAttribute("data-tc-name", "Bad Data");
  dataUrl.setAttribute("data-tc-price", "1.00");
  dataUrl.setAttribute("data-tc-img", "data:image/svg+xml;base64,PHN2Zz4=");
  document.body.append(good, scriptUrl, dataUrl);

  for (const button of [good, scriptUrl, dataUrl]) {
    document.dispatchEvent(new FakeEvent("click", { target: button }));
  }
  await new Promise((resolve) => setTimeout(resolve, 70));

  const thumbs = document.querySelectorAll(".tc-thumb");
  assert.equal(thumbs.length, 1);
  assert.equal(thumbs[0].getAttribute("src"), "images/tee.svg");
  assert.equal(thumbs[0].getAttribute("loading"), "lazy");
  assert.equal(thumbs[0].getAttribute("alt"), "");
  assert.equal(thumbs[0].getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(document.querySelectorAll(".tc-has-img").length, 1);

  fillCheckoutForm(document);
  document.querySelector(".tc-form").dispatchEvent(new FakeEvent("submit"));
  await flushAsync();

  assert.equal(checkoutPayload.cart.items.length, 3);
  assert.equal("img" in checkoutPayload.cart.items[0], false);
  assert.equal(JSON.stringify(checkoutPayload).includes("images/tee.svg"), false);
});

test("validates checkout fields inline without toast spam", () => {
  const { window, document } = createHarness();
  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  const toastBefore = document.querySelector(".tc-toast").textContent;
  const form = document.querySelector(".tc-form");
  form.dispatchEvent(new FakeEvent("submit"));

  const name = document.querySelector('[name="name"]');
  const phone = document.querySelector('[name="phone"]');
  const address = document.querySelector('[name="address"]');
  assert.equal(document.activeElement, name);
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.equal(document.getElementById(name.getAttribute("aria-describedby")).textContent, "Please complete required fields.");
  assert.equal(phone.getAttribute("aria-invalid"), "true");
  assert.equal(address.getAttribute("aria-invalid"), "true");
  assert.equal(document.querySelector(".tc-toast").textContent, toastBefore);

  phone.value = "call me";
  phone.dispatchEvent(new FakeEvent("blur"));
  assert.equal(document.getElementById(phone.getAttribute("aria-describedby")).textContent, "Use 6-20 digits, spaces, +, -, or ().");

  const email = document.querySelector('[name="email"]');
  email.value = "bad-email";
  email.dispatchEvent(new FakeEvent("blur"));
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(document.getElementById(email.getAttribute("aria-describedby")).textContent, "Enter a valid email.");
});

test("uses SVG polish for close, empty state, and added rows", () => {
  const { window, document } = createHarness();
  const css = document.getElementById("tinycart-style").textContent;

  assert.equal(document.querySelector(".tc-iconbtn").textContent, "");
  assert.ok(document.querySelector(".tc-x"));
  assert.ok(document.querySelector(".tc-empty-icon"));
  assert.equal(document.querySelector(".tc-empty-hint").textContent, "Browse products");
  assert.match(css, /\.tc-added\{animation:tc-glow/);
  assert.match(css, /prefers-reduced-motion:reduce[^{]*\{[^}]*\.tc-added/);

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  assert.ok(document.querySelector(".tc-added"));
});

test("renders payment choices and submits the selected payment method", async () => {
  let checkoutPayload;
  let copied = "";
  const { window, document } = createHarness({
    scriptConfig: {
      paymentMethods: ["online", "cod"],
      defaultPaymentMethod: "cod"
    },
    fetch: async (_url, options) => {
      checkoutPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, order_id: "TCOD123", pay_url: null })
      };
    }
  });
  window.navigator.clipboard = {
    writeText: async (value) => {
      copied = value;
    }
  };

  const radios = document.querySelectorAll('input[name="paymentMethod"]');
  assert.equal(radios.length, 2);
  assert.equal(radios[0].value, "online");
  assert.equal(radios[1].value, "cod");
  assert.equal(radios[1].checked, true);
  assert.ok(Array.from(document.querySelector(".tc-payment").querySelectorAll("label"))
    .some((label) => /Cash on delivery/.test(label.textContent)));

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  fillCheckoutForm(document);
  document.querySelector(".tc-form").dispatchEvent(new FakeEvent("submit"));
  await flushAsync();

  assert.equal(checkoutPayload.paymentMethod, "cod");
  assert.equal(document.querySelector(".tc-success-title").textContent, "Order placed");
  assert.equal(document.activeElement, document.querySelector(".tc-success-title"));
  assert.equal(document.querySelector(".tc-order-id").textContent, "TCOD123");
  assert.equal(document.querySelector(".tc-success-note").textContent, "Pay $24.00 in cash on delivery.");
  assert.equal(window.tinycart.getCart().totals.count, 0);

  document.querySelector(".tc-copy").dispatchEvent(new FakeEvent("click"));
  await flushAsync();
  assert.equal(copied, "TCOD123");
  assert.equal(document.querySelector(".tc-copy").textContent, "Copied");

  document.querySelector(".tc-continue").dispatchEvent(new FakeEvent("click"));
  assert.equal(document.querySelector(".tc-backdrop").getAttribute("aria-hidden"), "true");
  document.querySelector(".tc-float").dispatchEvent(new FakeEvent("click"));
  assert.equal(document.querySelector(".tc-empty").textContent, "Your cart is empty.");
});

test("previews shipping zones while submitting only the selected zone", async () => {
  let checkoutPayload;
  const { window, document } = createHarness({
    scriptConfig: {
      shipping: {
        zones: [
          { id: "local", label: "Local pickup", amountCents: 200 },
          { id: "remote", label: "Remote delivery", amountCents: 900 }
        ]
      }
    },
    fetch: async (_url, options) => {
      checkoutPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, order_id: "TSHIP1", pay_url: null })
      };
    }
  });

  const select = document.querySelector('select[name="shippingZone"]');
  assert.ok(select);
  assert.equal(select.children.length, 2);
  assert.equal(select.children[0].textContent, "Local pickup");
  assert.equal(select.children[1].textContent, "Remote delivery");

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  select.value = "remote";
  select.dispatchEvent(new FakeEvent("change"));
  assert.equal(document.querySelector(".tc-shipping").textContent, "$9.00");
  assert.equal(document.querySelector(".tc-modal-total").textContent, "$33.00");

  fillCheckoutForm(document);
  document.querySelector(".tc-form").dispatchEvent(new FakeEvent("submit"));
  await flushAsync();

  assert.deepEqual(checkoutPayload.shipping, { zone: "remote" });
  assert.equal("amount_cents" in checkoutPayload.shipping, false);
  assert.equal(checkoutPayload.cart.totals.shippingCents, 900);
  assert.equal(checkoutPayload.cart.totals.totalCents, 3300);
});

test("online checkout renders payment handoff before redirect", async () => {
  let assigned = "";
  const { window, document } = createHarness({
    scriptConfig: {
      paymentMethods: ["online"],
      defaultPaymentMethod: "online"
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, order_id: "TONLINE9", pay_url: "https://pay.example/checkout" })
    })
  });
  window.location.assign = (url) => {
    assigned = url;
  };

  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  fillCheckoutForm(document);
  document.querySelector(".tc-form").dispatchEvent(new FakeEvent("submit"));
  await flushAsync();

  assert.equal(document.querySelector(".tc-success-title").textContent, "Order placed");
  assert.equal(document.querySelector(".tc-order-id").textContent, "TONLINE9");
  assert.equal(document.querySelector(".tc-success-note").textContent, "Complete payment on the next page.");
  assert.equal(assigned, "https://pay.example/checkout");
});

test("keeps checkout locked while pending and maps HTTP failures to helpful messages", async () => {
  const cases = [
    [400, "Validation failed. Check your cart and checkout details."],
    [403, "Checkout is not allowed from this page."],
    [409, "Some items are out of stock."],
    [429, "Too many checkout attempts. Please wait and try again."]
  ];

  for (const [status, expectedMessage] of cases) {
    const { window, document } = createHarness({
      fetch: async () => ({
        ok: false,
        status,
        json: async () => ({ ok: false, error: "Server message" })
      })
    });
    window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
    fillCheckoutForm(document);

    const form = document.querySelector(".tc-form");
    const submit = document.querySelector('button[form="tc-checkout-form"]');
    form.dispatchEvent(new FakeEvent("submit"));

    assert.equal(submit.disabled, true);
    assert.equal(submit.textContent, "Processing...");

    await flushAsync();

    assert.equal(document.querySelector(".tc-toast").textContent, expectedMessage);
    assert.equal(submit.disabled, false);
    assert.equal(submit.textContent, "Checkout");
    assert.equal(window.tinycart.getCart().totals.count, 1);
  }
});

test("maps network checkout failures without clearing the cart", async () => {
  const { window, document } = createHarness({
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  window.tinycart.add({ id: "tee-001", name: "TinyCart Tee", price: "24.00", qty: 1 });
  fillCheckoutForm(document);

  document.querySelector(".tc-form").dispatchEvent(new FakeEvent("submit"));
  await flushAsync();

  assert.equal(document.querySelector(".tc-toast").textContent, "Network error. Check your connection and try again.");
  assert.equal(window.tinycart.getCart().totals.count, 1);
});

test("discards corrupt stored carts and drops unsafe nested options", () => {
  const storage = createStorage({
    "tinycart:default": "{this is not json"
  });
  const { window } = createHarness({ storage });

  assert.equal(window.tinycart.getCart().totals.count, 0);

  window.tinycart.add({
    id: "tee-001",
    name: "TinyCart Tee",
    price: "24.00",
    options: {
      size: "M",
      nested: { bad: true },
      __proto__: "blocked"
    }
  });

  const options = window.tinycart.getCart().items[0].options;
  assert.equal(options.size, "M");
  assert.deepEqual(Object.keys(options), ["size"]);
});

test("reload preserves cart items, options, coupon, and schema version", async () => {
  const storage = createStorage();
  const first = createHarness({
    storage,
    scriptConfig: {
      coupons: { SAVE10: { type: "percent", value: 10 } }
    }
  });

  first.window.tinycart.add({
    id: "tee-001",
    name: "TinyCart Tee",
    price: "24.00",
    qty: 2,
    options: { size: "M", color: "Black" }
  });
  await first.window.tinycart.applyCoupon("SAVE10");

  const raw = JSON.parse(storage.getItem("tinycart:default"));
  assert.equal(raw.version, 2);

  const second = createHarness({ storage });
  const cart = second.window.tinycart.getCart();
  assert.equal(cart.items[0].qty, 2);
  assert.deepEqual(Object.keys(cart.items[0].options).sort(), ["color", "size"]);
  assert.equal(cart.coupon.code, "SAVE10");
  assert.equal(cart.totals.discountCents, 480);
});

test("future cart schema versions are safely cleared", () => {
  const storage = createStorage({
    "tinycart:default": JSON.stringify({
      version: 99,
      items: [{ id: "tee-001", name: "TinyCart Tee", priceCents: 2400, qty: 1 }]
    })
  });
  const { window } = createHarness({ storage });

  assert.equal(window.tinycart.getCart().totals.count, 0);
});
