(function (win, doc) {
"use strict";

const D = {
cartKey: "default",
currency: "USD",
locale: null,
apiCheckout: "/checkout.php",
apiCoupon: null,
catalogUrl: null,
analyticsUrl: null,
apiKey: null,
accent: null,
coupons: {},
paymentMethods: [],
defaultPaymentMethod: "",
allowedOptionKeys: null,
maxItems: 100,
maxStorageBytes: 50 * 1024,
maxQueueItems: 20,
maxQueueBytes: 24 * 1024,
queueRetentionMs: 24 * 60 * 60 * 1000,
retryBaseMs: 1500,
strings: {},
onCheckout: null,
onValidateCoupon: null
};

const STRINGS = {
cart: "Cart",
openCart: "Open cart",
title: "Your cart",
closeCart: "Close cart",
coupon: "Coupon code",
apply: "Apply",
name: "Name",
phone: "Phone",
email: "Email",
address: "Address",
subtotal: "Subtotal",
discount: "Discount",
total: "Total",
checkout: "Checkout",
paymentMethod: "Payment method",
paymentOnline: "Pay online",
paymentCod: "Cash on delivery",
paymentManual: "Manual payment",
processing: "Processing...",
empty: "Your cart is empty.",
remove: "Remove",
itemAdded: "{{name}} added",
cartTooLarge: "Cart is too large. Remove an item before adding more.",
saveFailed: "Cart could not be saved in this browser.",
badProduct: "This product cannot be added.",
itemLimit: "Cart item limit reached.",
badOptions: "Product options are invalid JSON.",
couponRemoved: "Coupon removed.",
checkingCoupon: "Checking coupon...",
couponInvalid: "Coupon not valid.",
couponFailed: "Coupon validation failed.",
couponApplied: "{{code}} applied.",
addItem: "Add an item before checkout.",
  required: "Please complete required fields.",
  phoneInvalid: "Use 6-20 digits, spaces, +, -, or ().",
  emailInvalid: "Enter a valid email.",
  browseProducts: "Browse products",
  orderReceived: "Order received.",
orderPlaced: "Order placed",
codDue: "Pay {{total}} in cash on delivery.",
onlineNext: "Complete payment on the next page.",
continueShopping: "Continue shopping",
copyOrder: "Copy",
copied: "Copied",
network: "Network error. Check your connection and try again.",
checkout400: "Validation failed. Check your cart and checkout details.",
checkout403: "Checkout is not allowed from this page.",
outOfStock: "Some items are out of stock.",
checkout429: "Too many checkout attempts. Please wait and try again.",
checkoutFailed: "Checkout failed. Try again.",
decQty: "Decrease {{name}} quantity",
incQty: "Increase {{name}} quantity",
qtyFor: "Quantity for {{name}}",
option: "{{key}}: {{value}}"
};

const s = {
c: { ...D },
i: [],
cat: {},
cp: null,
h: {},
initialized: false,
root: null,
float: null,
m: null,
list: null,
count: null,
total: null,
modalTotal: null,
discount: null,
note: null,
body: null,
foot: null,
couponBox: null,
form: null,
pay: [],
ci: null,
cs: null,
back: null,
pending: false,
done: false,
rt: 0
};

const selectors = "[data-tc-id]";
const storageKey = () => `tinycart:${s.c.cartKey || "default"}`;
const queueKey = () => `tinycart:${s.c.cartKey || "default"}:queue`;
const CART_VERSION = 2;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const now = () => Date.now();
const int = Number.parseInt;

function htmlEscape(value) {
return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
"&": "&amp;",
"<": "&lt;",
">": "&gt;",
'"': "&quot;",
"'": "&#39;"
})[char]);
}

function setText(node, value) {
node.textContent = String(value == null ? "" : value);
}

function safeTemplate(template, values = {}, allowTags = false) {
const source = String(template == null ? "" : template);
if (!allowTags && /<[^>]*>/g.test(source)) {
throw new Error("TinyCart template strings cannot contain tags.");
}
return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => htmlEscape(values[key]));
}

function text(key, values) {
const value = s.c.strings && s.c.strings[key] != null ? s.c.strings[key] : STRINGS[key];
return safeTemplate(value == null ? "" : value, values || {});
}

function str(value, max = 180) {
return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function safeEmail(value) {
const email = str(value, 254);
return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function safeImg(value) {
const url = str(value, 500);
return url && (!/^[a-z][a-z0-9+.-]*:/i.test(url) || /^https?:/i.test(url)) ? url : "";
}

function normalizePaymentMethods(methods) {
const allowed = ["online", "cod", "manual"];
const unique = [];
(Array.isArray(methods) ? methods : []).forEach((method) => {
const clean = str(method, 20).toLowerCase();
if (allowed.includes(clean) && !unique.includes(clean)) unique.push(clean);
});
return unique;
}

function resolveDefaultPaymentMethod(methods, preferred) {
const clean = str(preferred, 20).toLowerCase();
return methods.includes(clean) ? clean : (methods[0] || "");
}

function paymentLabel(method) {
return text(method === "cod" ? "paymentCod" : method === "manual" ? "paymentManual" : "paymentOnline");
}

function toCents(value) {
if (typeof value === "number" && Number.isFinite(value)) {
return Math.round(value * 100);
}
const clean = String(value == null ? "" : value).trim();
if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
const [whole, fraction = ""] = clean.split(".");
return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

function centsToDecimal(cents) {
return Number((Number(cents || 0) / 100).toFixed(2));
}

function money(cents) {
try {
return new Intl.NumberFormat(s.c.locale || undefined, {
  style: "currency",
  currency: s.c.currency || "USD"
}).format(centsToDecimal(cents));
} catch (_) {
return `${s.c.currency || "USD"} ${centsToDecimal(cents).toFixed(2)}`;
}
}

function readableAccent(color) {
const raw = color.replace("#", "");
const hex = raw.length === 3 ? raw.replace(/./g, "$&$&") : raw.slice(0, 6);
if (!/^[0-9a-f]{6}$/i.test(hex)) return "#111111";
const lum = [0, 2, 4].map((i) => int(hex.slice(i, i + 2), 16) / 255)
.map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
.reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
return 1.05 / (lum + 0.05) >= 4.5 ? color : "#111111";
}

function stableStringify(value) {
if (value === null || typeof value !== "object") return JSON.stringify(value);
if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function itemKey(item) {
return `${str(item.id, 120)}::${stableStringify(item.options || {})}`;
}

function debounce(fn, wait) {
let timer = 0;
return function debounced(...args) {
win.clearTimeout(timer);
timer = win.setTimeout(() => fn.apply(this, args), wait);
};
}

function throttle(fn, wait) {
let last = 0;
let timer = 0;
return function throttled(...args) {
const remaining = wait - (now() - last);
if (remaining <= 0) {
  win.clearTimeout(timer);
  timer = 0;
  last = now();
  fn.apply(this, args);
} else if (!timer) {
  timer = win.setTimeout(() => {
    last = now();
    timer = 0;
    fn.apply(this, args);
  }, remaining);
}
};
}

function emit(eventName, detail = {}) {
(s.h[eventName] || []).slice().forEach((handler) => {
try { handler(detail); } catch (err) { win.setTimeout(() => { throw err; }); }
});
try {
doc.dispatchEvent(new CustomEvent(`tinycart:${eventName}`, { detail }));
} catch (_) {}
}

function loadCart() {
try {
const raw = win.localStorage.getItem(storageKey());
if (!raw || raw.length > s.c.maxStorageBytes) return;
const saved = JSON.parse(raw);
if (!saved || !Array.isArray(saved.items)) return;
const version = saved.version == null ? 1 : Number(saved.version);
if (!Number.isFinite(version) || version > CART_VERSION || version < 1) {
  win.localStorage.removeItem(storageKey());
  return;
}
s.i = saved.items.map(normalizeItem).filter(Boolean).slice(0, s.c.maxItems);
s.cp = normalizeCoupon(saved.coupon);
} catch (_) {
s.i = [];
s.cp = null;
}
}

function saveCart() {
const payload = JSON.stringify({
version: CART_VERSION,
updatedAt: new Date().toISOString(),
coupon: s.cp,
items: s.i.slice(0, s.c.maxItems)
});
if (payload.length > s.c.maxStorageBytes) {
toast(text("cartTooLarge"));
return false;
}
try {
win.localStorage.setItem(storageKey(), payload);
return true;
} catch (_) {
toast(text("saveFailed"));
return false;
}
}

function loadQueue() {
try {
const raw = win.localStorage.getItem(queueKey());
if (!raw || raw.length > s.c.maxQueueBytes) return [];
const parsed = JSON.parse(raw);
if (!Array.isArray(parsed)) return [];
const cutoff = now() - s.c.queueRetentionMs;
return parsed
  .filter((entry) => entry && entry.createdAt > cutoff)
  .slice(0, s.c.maxQueueItems);
} catch (_) {
return [];
}
}

function saveQueue(queue) {
const compact = queue.slice(-s.c.maxQueueItems);
const payload = JSON.stringify(compact);
if (payload.length > s.c.maxQueueBytes) {
compact.splice(0, Math.ceil(compact.length / 2));
}
try {
win.localStorage.setItem(queueKey(), JSON.stringify(compact));
} catch (_) {}
}

function normalizeCoupon(coupon) {
if (!coupon || typeof coupon !== "object") return null;
const code = str(coupon.code, 40).toUpperCase();
if (!code) return null;
const type = coupon.type === "fixed" ? "fixed" : "percent";
const value = Math.max(0, Number(coupon.value || 0));
const amount = Math.max(0, Number(coupon.amount || 0));
return { code, type, value, amount, server: !!coupon.server };
}

function normalizeItem(input) {
if (!input || typeof input !== "object") return null;
const id = str(input.id || input.itemId, 120);
const name = str(input.name, 180);
const cents = Number.isInteger(input.priceCents) ? input.priceCents : toCents(input.price);
const stock = input.stock === "" || input.stock == null ? null : Math.max(0, int(input.stock, 10));
const qty = clamp(int(input.qty || 1, 10) || 1, 1, stock || 999);
if (!id || !name || !Number.isFinite(cents) || cents < 0) return null;
const options = sanitizeOptions(input.options);
const sig = str(input.sig || input.signature || "", 512);
const exp = str(input.exp || input.expires || "", 40);
const img = safeImg(input.img || input.image || "");
return {
key: itemKey({ id, options }),
id,
name,
priceCents: cents,
qty,
options,
stock,
sig,
exp,
img
};
}

function sanitizeOptions(input) {
if (!input || typeof input !== "object" || Array.isArray(input)) return {};
const allowed = Array.isArray(s.c.allowedOptionKeys)
? new Set(s.c.allowedOptionKeys.map((key) => str(key, 40)))
: null;
const clean = {};
Object.keys(input).slice(0, 20).forEach((key) => {
const safeKey = str(key, 40);
if (!safeKey || safeKey.startsWith("__") || (allowed && !allowed.has(safeKey))) return;
const value = input[key];
if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
  clean[safeKey] = str(value, 120);
}
});
return clean;
}

function totals() {
const subtotal = s.i.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
const discount = s.cp ? clamp(Math.round(Number(s.cp.amount || 0)), 0, subtotal) : 0;
return {
count: s.i.reduce((sum, item) => sum + item.qty, 0),
subtotal,
discount,
total: Math.max(0, subtotal - discount)
};
}

function recalcCoupon() {
if (!s.cp) return;
const subtotal = s.i.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
if (s.cp.type === "fixed") {
s.cp.amount = clamp(Math.round(Number(s.cp.value) * 100), 0, subtotal);
} else {
s.cp.amount = clamp(Math.round(subtotal * (Number(s.cp.value) / 100)), 0, subtotal);
}
}

function add(input) {
const item = normalizeItem(input);
if (!item) {
toast(text("badProduct"));
return false;
}
const existing = s.i.find((candidate) => candidate.key === item.key);
if (existing) {
existing.qty = clamp(existing.qty + item.qty, 1, existing.stock || 999);
} else {
if (s.i.length >= s.c.maxItems) {
  toast(text("itemLimit"));
  return false;
}
s.i.push(item);
}
s.added = item.key;
changed();
toast(text("itemAdded", { name: item.name }));
pulseCart();
return true;
}

function remove(itemId) {
const before = s.i.length;
s.i = s.i.filter((item) => item.key !== itemId && item.id !== itemId);
if (s.i.length !== before) changed();
}

function update(itemId, patch = {}) {
const item = s.i.find((candidate) => candidate.key === itemId || candidate.id === itemId);
if (!item) return;
if (patch.qty != null) {
const nextQty = int(patch.qty, 10);
if (!Number.isFinite(nextQty) || nextQty <= 0) {
  remove(item.key);
  return;
}
item.qty = clamp(nextQty, 1, item.stock || 999);
}
changed();
}

function clear() {
s.i = [];
s.cp = null;
changed();
}

function changed() {
recalcCoupon();
saveCart();
scheduleRender();
emit("cart:updated", getCart());
}

function getCart() {
const sum = totals();
return {
cartKey: s.c.cartKey,
currency: s.c.currency,
items: s.i.map((item) => ({
  id: item.id,
  key: item.key,
  name: item.name,
  price: centsToDecimal(item.priceCents),
  priceCents: item.priceCents,
  qty: item.qty,
  options: item.options,
  stock: item.stock,
  sig: item.sig,
  exp: item.exp
})),
coupon: s.cp,
totals: {
  count: sum.count,
  subtotal: centsToDecimal(sum.subtotal),
  subtotalCents: sum.subtotal,
  discount: centsToDecimal(sum.discount),
  discountCents: sum.discount,
  total: centsToDecimal(sum.total),
  totalCents: sum.total
}
};
}

function parseOptions(raw) {
if (!raw) return {};
try {
const parsed = JSON.parse(raw);
return sanitizeOptions(parsed);
} catch (_) {
toast(text("badOptions"));
return {};
}
}

function itemFromElement(el) {
const id = el.getAttribute("data-tc-id");
const product = s.cat[id];
return {
id,
name: product ? product.name : el.getAttribute("data-tc-name"),
price: product ? undefined : el.getAttribute("data-tc-price"),
priceCents: product ? product.price_cents : undefined,
qty: el.getAttribute("data-tc-qty") || 1,
options: parseOptions(el.getAttribute("data-tc-options")),
img: el.getAttribute("data-tc-img"),
stock: product ? product.stock : el.getAttribute("data-tc-stock"),
sig: el.getAttribute("data-tc-sig"),
exp: el.getAttribute("data-tc-exp")
};
}

function onProductClick(event) {
const trigger = event.target.closest ? event.target.closest(selectors) : null;
if (!trigger) return;
if (trigger.disabled || trigger.getAttribute("aria-disabled") === "true") return;
add(itemFromElement(trigger));
}

function onProductKeydown(event) {
if (event.key !== "Enter" && event.key !== " ") return;
const trigger = event.target.closest ? event.target.closest(selectors) : null;
if (!trigger) return;
if (trigger.disabled || trigger.getAttribute("aria-disabled") === "true") return;
event.preventDefault();
add(itemFromElement(trigger));
}

function create(tag, className, text) {
const el = doc.createElement(tag);
if (className) el.className = className;
if (text != null) setText(el, text);
return el;
}

function svg(tag) {
return doc.createElementNS ? doc.createElementNS("http://www.w3.org/2000/svg", tag) : doc.createElement(tag);
}

function icon(cls, d) {
const icon = svg("svg");
const path = svg("path");
icon.className = cls;
icon.setAttribute("viewBox", "0 0 24 24");
icon.setAttribute("aria-hidden", "true");
path.setAttribute("d", d);
path.setAttribute("fill", "none");
path.setAttribute("stroke", "currentColor");
path.setAttribute("stroke-width", "3");
path.setAttribute("stroke-linecap", "round");
path.setAttribute("stroke-linejoin", "round");
icon.append(path);
return icon;
}

const checkIcon = () => icon("tc-check", "M20 6L9 17l-5-5");

function injectStyles() {
if (doc.getElementById("tinycart-style")) return;
const style = create("style");
style.id = "tinycart-style";
style.textContent = `
.tc-root{--tc-bg:#fff;--tc-fg:#111;--tc-muted:#666;--tc-line:#ddd;--tc-soft:#f7f7f7;--tc-accent:#111;--tc-radius:10px;--tc-font:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--b:var(--tc-bg);--f:var(--tc-fg);--m:var(--tc-muted);--l:var(--tc-line);--s:var(--tc-soft);--a:var(--tc-accent);--r:var(--tc-radius);--n:var(--tc-font);--bd:1px solid var(--l);--ba:1px solid var(--a);color-scheme:light;font-family:var(--n);color:var(--f)}
.tc-root *{box-sizing:border-box}
.tc-float{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:10px;min-height:48px;padding:0 16px;border:var(--ba);border-radius:999px;background:var(--a);color:#fff;box-shadow:0 12px 28px rgba(0,0,0,.16);font:700 14px/1 var(--n);cursor:pointer;touch-action:manipulation;transition:transform .18s ease,background .18s ease}
.tc-float:hover,.tc-float:focus-visible{background:var(--a);outline:2px solid transparent;transform:translateY(-1px)}
.tc-float.tc-pulse{animation:tc-pop .28s ease}
.tc-count{display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#fff;color:#111;font-size:12px}
.tc-backdrop{position:fixed;inset:0;z-index:2147483001;display:none;background:rgba(0,0,0,.28);padding:0}
.tc-backdrop[aria-hidden=false]{display:block}
.tc-dialog{position:fixed;inset:auto 12px 12px 12px;max-height:calc(100dvh - 24px);display:flex;flex-direction:column;padding:0;background:var(--b);border:var(--bd);border-radius:var(--r);box-shadow:0 18px 60px rgba(0,0,0,.18);overflow:hidden}
.tc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px 10px;border-bottom:var(--bd)}
.tc-title{margin:0;font-size:16px;line-height:1.2;font-weight:800;letter-spacing:0}
.tc-iconbtn{display:grid;place-items:center;width:38px;height:38px;border:var(--bd);border-radius:999px;background:var(--b);color:var(--f);cursor:pointer}
.tc-x{width:18px;height:18px}
.tc-iconbtn:hover,.tc-iconbtn:focus-visible{border-color:var(--f);outline:2px solid var(--a);outline-offset:2px}
.tc-body{overflow:auto;scrollbar-color:var(--f) var(--s);scrollbar-width:thin;padding:8px 16px 12px;overscroll-behavior:contain}
.tc-body::-webkit-scrollbar{width:10px}
.tc-body::-webkit-scrollbar-track{background:var(--s)}
.tc-body::-webkit-scrollbar-thumb{background:var(--f);border:2px solid var(--s)}
.tc-empty{display:grid;gap:7px;justify-items:center;padding:28px 0;color:var(--m);text-align:center;font-size:14px}
.tc-empty-icon{width:34px;height:34px}
.tc-empty-hint{display:block;font-size:12px}
.tc-item{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px 0;border-bottom:var(--bd)}
.tc-has-img{grid-template-columns:44px 1fr auto;align-items:start}
.tc-added{animation:tc-glow .7s ease}
.tc-thumb{width:44px;height:44px;border:var(--bd);border-radius:8px;background:var(--s);object-fit:cover}
.tc-name{font-weight:750;font-size:14px;line-height:1.25}
.tc-options{margin-top:5px;color:var(--m);font-size:12px;line-height:1.35;word-break:break-word}
.tc-price{margin-top:7px;font-weight:700;font-size:13px}
.tc-row-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
.tc-qty{display:flex;align-items:center;border:var(--bd);border-radius:999px;overflow:hidden}
.tc-qty button{width:34px;height:34px;border:0;background:var(--b);color:var(--f);font-size:18px;line-height:1;cursor:pointer}
.tc-qty input{width:44px;height:34px;border:0;border-inline:var(--bd);text-align:center;font:700 14px/1 var(--n)}
.tc-qty button:hover,.tc-remove:hover{background:var(--s)}
.tc-qty button:focus-visible,.tc-remove:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.tc-remove{height:34px;border:var(--bd);border-radius:999px;background:var(--b);padding:0 11px;cursor:pointer;color:var(--f);font-weight:650;font-size:13px}
.tc-line{display:flex;justify-content:space-between;gap:16px;padding:4px 0;color:var(--m);font-size:13px}
.tc-line strong{color:var(--f)}
.tc-coupon{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}
.tc-input,.tc-field input,.tc-field textarea{width:100%;min-height:42px;border:var(--bd);border-radius:calc(var(--r)*.8);background:var(--b);color:var(--f);padding:9px 11px;font:500 14px/1.3 var(--n)}
.tc-field textarea{min-height:64px;resize:vertical}
.tc-input:focus,.tc-field input:focus,.tc-field textarea:focus{outline:2px solid var(--a);outline-offset:1px}
.tc-btn{min-height:42px;border:var(--ba);border-radius:999px;background:var(--a);color:#fff;padding:0 15px;font:800 13px/1 var(--n);cursor:pointer}
.tc-btn:hover,.tc-btn:focus-visible{background:var(--a);outline:2px solid transparent}
.tc-btn[disabled]{opacity:.55;cursor:not-allowed}
.tc-coupon-status{min-height:16px;margin:6px 0 0;color:var(--m);font-size:12px}
.tc-form{display:grid;gap:8px;margin-top:8px;padding-top:10px;border-top:var(--bd)}
.tc-field span{display:block;margin:0 0 6px;font-size:12px;font-weight:750;color:var(--m)}
.tc-error{min-height:15px;color:#b42318;font-size:12px}
.tc-field [aria-invalid=true]{border-color:#b42318}
.tc-payment{display:grid;gap:6px;padding-bottom:2px}
.tc-payment>span{font-size:12px;font-weight:750;color:var(--m)}
.tc-payment label{display:flex;align-items:center;gap:8px;min-height:34px;border:var(--bd);border-radius:999px;padding:0 10px;font-size:13px;font-weight:650}
.tc-payment input{width:14px;height:14px;margin:0;accent-color:var(--a)}
.tc-foot{padding:10px 16px 12px;border-top:var(--bd);background:var(--b)}
.tc-toast{position:fixed;left:16px;right:16px;bottom:76px;z-index:2147483002;display:none;padding:12px 14px;border:var(--ba);border-radius:calc(var(--r)*1.1);background:var(--a);color:#fff;text-align:center;font:700 13px/1.35 var(--n);box-shadow:0 14px 42px rgba(0,0,0,.2)}
.tc-toast[aria-hidden=false]{display:block;animation:tc-slide .2s ease}
.tc-success{display:grid;gap:12px;justify-items:start;padding:20px 0 6px}
.tc-check{width:42px;height:42px;padding:9px;border-radius:999px;background:var(--a);color:#fff}
.tc-success-title{margin:0;font-size:19px;line-height:1.2}
.tc-success-note{margin:0;color:var(--m);font-size:14px}
.tc-order{display:flex;gap:8px;align-items:center;max-width:100%}
.tc-order-id{overflow:auto;max-width:220px;padding:9px 10px;border:var(--bd);border-radius:calc(var(--r)*.6);font:700 13px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}
.tc-copy{min-height:34px;padding:0 11px}
.tc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media (min-width:720px){.tc-float{right:24px;bottom:24px}.tc-dialog{inset:24px 24px 24px auto;width:min(420px,calc(100vw - 48px));max-height:calc(100dvh - 48px);border-radius:var(--r)}.tc-toast{left:auto;right:24px;bottom:88px;width:320px}.tc-body{padding-inline:18px}.tc-head,.tc-foot{padding-inline:18px}}
@media (prefers-color-scheme:dark){.tc-root:not([style*="--tc-bg"]){--tc-bg:#111;--tc-fg:#f5f5f5;--tc-muted:#bbb;--tc-line:#333;--tc-soft:#1b1b1b;color-scheme:dark}}
@media (prefers-reduced-motion:reduce){.tc-float,.tc-toast,.tc-added{transition:none;animation:none!important}}
@keyframes tc-pop{50%{transform:scale(1.04)}}
@keyframes tc-slide{from{transform:translateY(8px);opacity:.2}to{transform:translateY(0);opacity:1}}
@keyframes tc-glow{50%{background:var(--s)}}
`;
doc.head.appendChild(style);
}

function buildUI() {
injectStyles();
if (s.root) s.root.remove();

const root = create("div", "tc-root");
if (s.c.accent) root.style.setProperty("--tc-accent", s.c.accent);

const float = create("button", "tc-float");
float.type = "button";
float.setAttribute("aria-label", text("openCart"));
float.append(create("span", "", text("cart")));
const count = create("span", "tc-count", "0");
count.setAttribute("aria-live", "polite");
count.setAttribute("aria-atomic", "true");
float.append(count);
float.addEventListener("click", openCart);

const backdrop = create("div", "tc-backdrop");
backdrop.setAttribute("aria-hidden", "true");
backdrop.addEventListener("click", (event) => {
if (event.target === backdrop) closeCart();
});

const dialog = create("section", "tc-dialog");
dialog.setAttribute("role", "dialog");
dialog.setAttribute("aria-modal", "true");
dialog.setAttribute("aria-labelledby", "tc-title");

const head = create("div", "tc-head");
const title = create("h2", "tc-title", text("title"));
title.id = "tc-title";
const close = create("button", "tc-iconbtn");
close.type = "button";
close.setAttribute("aria-label", text("closeCart"));
close.addEventListener("click", closeCart);
close.append(icon("tc-x", "M6 6l12 12M18 6L6 18"));
head.append(title, close);

const body = create("div", "tc-body");
const list = create("div", "tc-list");
body.append(list);

const coupon = create("div");
coupon.className = "tc-coupon";
const couponInput = create("input", "tc-input");
couponInput.type = "text";
couponInput.autocomplete = "off";
couponInput.placeholder = text("coupon");
couponInput.setAttribute("aria-label", text("coupon"));
const couponButton = create("button", "tc-btn", text("apply"));
couponButton.type = "button";
couponButton.addEventListener("click", () => applyCoupon(couponInput.value));
coupon.append(couponInput, couponButton);
const couponStatus = create("div", "tc-coupon-status");
couponStatus.setAttribute("aria-live", "polite");
body.append(coupon, couponStatus);

const form = create("form", "tc-form");
form.noValidate = true;
const payment = paymentControls();
if (payment) form.append(payment);
form.append(
field(text("name"), "name", "text", true),
field(text("phone"), "phone", "tel", true),
field(text("email"), "email", "email", false),
field(text("address"), "address", "textarea", true)
);
form.addEventListener("submit", checkout);
body.append(form);

const foot = create("div", "tc-foot");
const subtotalLine = create("div", "tc-line");
subtotalLine.append(create("span", "", text("subtotal")), create("strong", "tc-total", money(0)));
const discountLine = create("div", "tc-line");
discountLine.append(create("span", "", text("discount")), create("strong", "tc-discount", money(0)));
const totalLine = create("div", "tc-line");
totalLine.append(create("span", "", text("total")), create("strong", "tc-modal-total", money(0)));
const submit = create("button", "tc-btn", text("checkout"));
submit.type = "submit";
submit.setAttribute("form", form.id = "tc-checkout-form");
foot.append(subtotalLine, discountLine, totalLine, submit);

const toastEl = create("div", "tc-toast");
toastEl.setAttribute("role", "status");
toastEl.setAttribute("aria-live", "polite");
toastEl.setAttribute("aria-hidden", "true");

dialog.append(head, body, foot);
backdrop.append(dialog);
root.append(float, backdrop, toastEl);
doc.body.append(root);

s.root = root;
s.float = float;
s.m = backdrop;
s.list = list;
s.count = count;
s.total = subtotalLine.querySelector(".tc-total");
s.discount = discountLine.querySelector(".tc-discount");
s.mTotal = totalLine.querySelector(".tc-modal-total");
s.note = toastEl;
s.body = body;
s.foot = foot;
s.couponBox = coupon;
s.form = form;
s.ci = couponInput;
s.cs = couponStatus;
s.done = false;
}

function paymentControls() {
s.pay = [];
const methods = s.c.paymentMethods || [];
if (methods.length < 2) return null;
const wrap = create("div", "tc-payment");
wrap.setAttribute("role", "radiogroup");
wrap.setAttribute("aria-label", text("paymentMethod"));
wrap.append(create("span", "", text("paymentMethod")));
methods.forEach((method) => {
const label = create("label");
const input = create("input");
input.type = "radio";
input.name = "paymentMethod";
input.value = method;
input.checked = method === s.c.defaultPaymentMethod;
label.append(input, create("span", "", paymentLabel(method)));
if (label.textContent === "") label.textContent = paymentLabel(method);
wrap.append(label);
s.pay.push(input);
});
return wrap;
}

function field(label, name, type, required) {
const wrap = create("label", "tc-field");
const span = create("span", "", label);
const err = create("small", "tc-error");
let input;
if (type === "textarea") {
input = create("textarea");
input.rows = 3;
} else {
input = create("input");
input.type = type;
}
input.name = name;
input.autocomplete = name === "email" ? "email" : name;
if (required) input.required = true;
err.id = `tc-${name}-error`;
err.setAttribute("aria-live", "polite");
input.setAttribute("aria-describedby", err.id);
input.addEventListener("blur", () => validateField(input));
wrap.append(span, input, err);
return wrap;
}

function validateField(input) {
const value = str(input.value, input.name === "address" ? 500 : 120);
let message = "";
if (input.required && !value) message = text("required");
else if (input.name === "phone" && !/^[0-9+\-() ]{6,20}$/.test(value)) message = text("phoneInvalid");
else if (input.name === "email" && value && !safeEmail(value)) message = text("emailInvalid");
input.setAttribute("aria-invalid", message ? "true" : "false");
setText(doc.getElementById(input.getAttribute("aria-describedby")), message);
return !message;
}

function validateForm() {
let first = null;
Array.from(s.form.querySelectorAll("input,textarea")).forEach((input) => {
if (!input.name || input.name === "paymentMethod") return;
if (!validateField(input) && !first) first = input;
});
if (first) first.focus();
return !first;
}

function render() {
if (!s.root) return;
const sum = totals();
setText(s.count, sum.count);
setText(s.total, money(sum.subtotal));
setText(s.discount, `-${money(sum.discount)}`);
setText(s.mTotal, money(sum.total));
if (s.ci && s.cp && s.ci.value.toUpperCase() !== s.cp.code) {
s.ci.value = s.cp.code;
}
if (s.done) return;

s.list.replaceChildren();
if (!s.i.length) {
const empty = create("div", "tc-empty", text("empty"));
empty.append(icon("tc-empty-icon", "M6 7h14l-2 8H8L6 7zM9 21h0M17 21h0M6 7L5 3H2"), create("small", "tc-empty-hint", text("browseProducts")));
s.list.append(empty);
return;
}

s.i.forEach((item) => {
const row = create("article", `tc-item${item.img ? " tc-has-img" : ""}${item.key === s.added ? " tc-added" : ""}`);
const main = create("div");
let thumb = null;
if (item.img) {
  thumb = create("img", "tc-thumb");
  thumb.setAttribute("src", item.img);
  thumb.setAttribute("loading", "lazy");
  thumb.setAttribute("alt", "");
  thumb.setAttribute("referrerpolicy", "no-referrer");
}
main.append(create("div", "tc-name", item.name));
const optionText = optionsLabel(item.options);
if (optionText) main.append(create("div", "tc-options", optionText));
main.append(create("div", "tc-price", money(item.priceCents)));

const actions = create("div", "tc-row-actions");
const qty = create("div", "tc-qty");
const minus = create("button", "", "-");
minus.type = "button";
minus.setAttribute("aria-label", text("decQty", { name: item.name }));
const input = create("input");
input.type = "number";
input.min = "1";
input.step = "1";
input.inputMode = "numeric";
input.value = String(item.qty);
input.setAttribute("aria-label", text("qtyFor", { name: item.name }));
if (item.stock) input.max = String(item.stock);
const plus = create("button", "", "+");
plus.type = "button";
plus.setAttribute("aria-label", text("incQty", { name: item.name }));
const delayedUpdate = debounce(() => update(item.key, { qty: input.value }), 250);
minus.addEventListener("click", () => update(item.key, { qty: item.qty - 1 }));
plus.addEventListener("click", () => update(item.key, { qty: item.qty + 1 }));
input.addEventListener("input", delayedUpdate);
qty.append(minus, input, plus);
const removeBtn = create("button", "tc-remove", text("remove"));
removeBtn.type = "button";
removeBtn.addEventListener("click", () => remove(item.key));
actions.append(qty, removeBtn);
main.append(actions);

const lineTotal = create("strong", "", money(item.priceCents * item.qty));
if (thumb) row.append(thumb);
row.append(main, lineTotal);
s.list.append(row);
});
}

function copyOrder(id, btn) {
const done = () => setText(btn, text("copied"));
const clip = win.navigator && win.navigator.clipboard;
if (clip && clip.writeText) {
clip.writeText(id).then(done, done);
} else {
done();
}
}

function restoreCartView() {
if (!s.done || !s.body) return;
s.done = false;
s.body.replaceChildren(s.list, s.couponBox, s.cs, s.form);
s.foot.hidden = false;
render();
}

function showSuccess(result, method, totalText) {
const id = str(result && (result.order_id || result.id) || "", 80);
const box = create("div", "tc-success");
const title = create("h3", "tc-success-title", text("orderPlaced"));
const row = create("div", "tc-order");
const copy = create("button", "tc-btn tc-copy", text("copyOrder"));
const cont = create("button", "tc-btn tc-continue", text("continueShopping"));
const message = method === "cod"
? text("codDue", { total: totalText })
: (method === "online" || result && result.pay_url ? text("onlineNext") : text("orderReceived"));
title.setAttribute("tabindex", "-1");
copy.type = "button";
cont.type = "button";
copy.addEventListener("click", () => copyOrder(id, copy));
cont.addEventListener("click", () => {
clear();
closeCart();
});
row.append(create("code", "tc-order-id", id), copy);
box.append(checkIcon(), title, row, create("p", "tc-success-note", message), cont);
s.body.replaceChildren(box);
s.foot.hidden = true;
title.focus();
}

const scheduleRender = throttle(render, 60);

function optionsLabel(options) {
if (!options || typeof options !== "object") return "";
return Object.keys(options).sort().map((key) => text("option", {
key,
value: options[key]
})).join(", ");
}

function requestHeaders(headers = {}) {
const safeHeaders = { ...headers };
const apiKey = str(s.c.apiKey || "", 300);
if (apiKey) safeHeaders["X-API-KEY"] = apiKey;
return safeHeaders;
}

function hydrateCatalog() {
if (!s.c.catalogUrl || !win.fetch) return;
win.fetch(s.c.catalogUrl, {
headers: requestHeaders({ "Accept": "application/json" }),
credentials: "same-origin"
}).then((response) => response.ok ? response.json() : null).then((data) => {
const items = Array.isArray(data && data.items) ? data.items : [];
s.cat = {};
items.forEach((item) => {
  const id = str(item && item.id, 120);
  const cents = int(item && item.price_cents, 10);
  if (!id || !Number.isFinite(cents)) return;
  s.cat[id] = {
    name: str(item.name, 180),
    price_cents: cents,
    stock: item.stock == null ? null : Math.max(0, int(item.stock, 10) || 0)
  };
});
doc.querySelectorAll("[data-tc-id]").forEach((el) => {
  const product = s.cat[el.getAttribute("data-tc-id")];
  if (!product) return;
  const soldOut = product.stock === 0;
  el.disabled = soldOut;
  el.setAttribute("aria-disabled", soldOut ? "true" : "false");
});
}).catch(() => {});
}

function readJsonResponse(response) {
return response.json().catch(() => ({}));
}

function checkoutError(status, fallback) {
const message = ({
400: text("checkout400"),
403: text("checkout403"),
409: text("outOfStock"),
429: text("checkout429")
})[status] || (status >= 500 ? text("checkoutFailed") : fallback || text("checkoutFailed"));
const error = new Error(message);
error.tinycart = 1;
return error;
}

function setSubmitPending(submit, pending) {
if (!submit) return;
submit.disabled = pending;
setText(submit, pending ? text("processing") : text("checkout"));
}

async function applyCoupon(rawCode) {
const code = str(rawCode, 40).toUpperCase();
if (!code) {
s.cp = null;
setText(s.cs, text("couponRemoved"));
changed();
emit("cart:applyCoupon", { code: "", ok: true, removed: true });
return;
}

setText(s.cs, text("checkingCoupon"));
let result = null;
try {
if (typeof s.c.onValidateCoupon === "function") {
  result = await s.c.onValidateCoupon(code, getCart());
} else if (s.c.apiCoupon) {
  const response = await win.fetch(s.c.apiCoupon, {
    method: "POST",
    headers: requestHeaders({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify({ code, cart: getCart() })
  });
  result = await readJsonResponse(response);
  if (!response.ok) {
    result = { ok: false, message: result.error || result.message || text("couponInvalid") };
  }
} else if (s.c.coupons && s.c.coupons[code]) {
  const local = s.c.coupons[code];
  result = typeof local === "number" ? { ok: true, type: "percent", value: local } : { ok: true, ...local };
}
} catch (_) {
result = { ok: false, message: text("couponFailed") };
}

if (!result || result.ok === false) {
s.cp = null;
setText(s.cs, str(result && result.message ? result.message : text("couponInvalid"), 120));
changed();
emit("cart:applyCoupon", { code, ok: false });
return;
}

s.cp = normalizeCoupon({
code,
type: result.type === "fixed" ? "fixed" : "percent",
value: Number(result.value || 0),
server: !!(s.c.apiCoupon || s.c.onValidateCoupon)
});
recalcCoupon();
setText(s.cs, text("couponApplied", { code: s.cp.code }));
changed();
emit("cart:applyCoupon", { code, ok: true, coupon: s.cp });
}

function formData() {
const data = new FormData(s.form);
return {
name: str(data.get("name"), 120),
phone: str(data.get("phone"), 40),
email: safeEmail(data.get("email")),
address: str(data.get("address"), 500)
};
}

function selectedPaymentMethod() {
const methods = s.c.paymentMethods || [];
if (!methods.length) return "";
const checked = (s.pay || []).find((input) => input.checked);
return checked ? checked.value : s.c.defaultPaymentMethod;
}

async function checkout(event) {
event.preventDefault();
if (s.pending) return;
if (!s.i.length) {
toast(text("addItem"));
return;
}
if (!validateForm()) return;

const customer = formData();

const submit = s.form.ownerDocument.querySelector('button[form="tc-checkout-form"]');
s.pending = true;
setSubmitPending(submit, true);
const payload = {
cartKey: s.c.cartKey,
currency: s.c.currency,
customer,
cart: getCart(),
page: win.location.href,
createdAt: new Date().toISOString()
};
const paymentMethod = selectedPaymentMethod();
if (paymentMethod) payload.paymentMethod = paymentMethod;

try {
let result;
if (typeof s.c.onCheckout === "function") {
  result = await s.c.onCheckout(payload);
  if (result && result.ok === false) throw checkoutError(0, result.error || result.message);
} else {
  const response = await win.fetch(s.c.apiCheckout, {
    method: "POST",
    headers: requestHeaders({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });
  result = await readJsonResponse(response);
  if (!response.ok || !result.ok) throw checkoutError(response.status, result.error || result.message);
}

const cart = getCart();
emit("cart:checkedout", { order: result, cart });
ping("checkout", { order_id: result && result.order_id, total: cart.totals.totalCents });
s.done = true;
clear();
showSuccess(result, paymentMethod, money(cart.totals.totalCents));
if (result && result.pay_url) win.location.assign(result.pay_url);
} catch (err) {
const message = err && err.tinycart
  ? err.message
  : text("network");
toast(str(message, 120));
} finally {
s.pending = false;
setSubmitPending(submit, false);
}
}

function openCart() {
if (!s.m) return;
s.back = doc.activeElement;
s.m.setAttribute("aria-hidden", "false");
doc.addEventListener("keydown", trapKeys, true);
const first = s.m.querySelector("button,input,textarea,[tabindex]:not([tabindex='-1'])");
if (first) first.focus();
emit("cart:opened", getCart());
}

function closeCart() {
if (!s.m) return;
s.m.setAttribute("aria-hidden", "true");
doc.removeEventListener("keydown", trapKeys, true);
if (s.back && s.back.focus) s.back.focus();
restoreCartView();
}

function trapKeys(event) {
if (event.key === "Escape") {
closeCart();
return;
}
if (event.key !== "Tab" || s.m.getAttribute("aria-hidden") === "true") return;
const focusable = Array.from(s.m.querySelectorAll("button,input,textarea,[href],[tabindex]:not([tabindex='-1'])"))
.filter((el) => !el.disabled && el.offsetParent !== null);
if (!focusable.length) return;
const first = focusable[0];
const last = focusable[focusable.length - 1];
if (event.shiftKey && doc.activeElement === first) {
event.preventDefault();
last.focus();
} else if (!event.shiftKey && doc.activeElement === last) {
event.preventDefault();
first.focus();
}
}

function toast(message) {
if (!s.note) return;
setText(s.note, message);
s.note.setAttribute("aria-hidden", "false");
win.clearTimeout(s.note._timer);
s.note._timer = win.setTimeout(() => s.note.setAttribute("aria-hidden", "true"), 2400);
}

function pulseCart() {
if (!s.float) return;
s.float.classList.remove("tc-pulse");
void s.float.offsetWidth;
s.float.classList.add("tc-pulse");
}

function ping(type, payload = {}) {
if (!s.c.analyticsUrl) return;
const event = {
type,
cartKey: s.c.cartKey,
currency: s.c.currency,
payload,
ts: new Date().toISOString()
};
sendPing(event, true).then((ok) => {
if (!ok) queuePing(event);
});
}

function sendPing(event, preferBeacon) {
const body = JSON.stringify(event);
try {
if (preferBeacon && !s.c.apiKey && navigator.sendBeacon) {
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon(s.c.analyticsUrl, blob)) return Promise.resolve(true);
}
} catch (_) {}
try {
return win.fetch(s.c.analyticsUrl, {
  method: "POST",
  headers: requestHeaders({ "Content-Type": "application/json" }),
  body,
  keepalive: true,
  credentials: "same-origin"
}).then((response) => response.ok).catch(() => false);
} catch (_) {
return Promise.resolve(false);
}
}

function queuePing(event) {
const queue = loadQueue();
queue.push({
event,
tries: 0,
createdAt: now(),
nextAt: now() + s.c.retryBaseMs
});
saveQueue(queue);
scheduleFlushQueue();
}

function scheduleFlushQueue() {
win.clearTimeout(s.rt);
const queue = loadQueue();
if (!queue.length) return;
const dueIn = Math.max(250, Math.min(...queue.map((entry) => entry.nextAt || now())) - now());
s.rt = win.setTimeout(flushQueue, dueIn);
}

function flushQueue() {
if (!s.c.analyticsUrl) return;
const queue = loadQueue();
const index = queue.findIndex((entry) => !entry.nextAt || entry.nextAt <= now());
if (index === -1) {
scheduleFlushQueue();
return;
}
const entry = queue[index];
sendPing(entry.event, false).then((ok) => {
const latest = loadQueue();
if (ok) {
  latest.splice(index, 1);
} else if (latest[index]) {
  latest[index].tries = (latest[index].tries || 0) + 1;
  latest[index].nextAt = now() + Math.min(60 * 1000, s.c.retryBaseMs * (2 ** latest[index].tries));
}
saveQueue(latest);
scheduleFlushQueue();
});
}

function bindProductListeners() {
doc.removeEventListener("click", onProductClick);
doc.removeEventListener("keydown", onProductKeydown);
doc.addEventListener("click", onProductClick);
doc.addEventListener("keydown", onProductKeydown);
}

function readScriptConfig() {
const script = doc.currentScript || Array.from(doc.scripts).reverse().find((candidate) => candidate.hasAttribute("data-tc-config"));
if (!script) return {};
const raw = script.getAttribute("data-tc-config");
if (!raw) return {};
try {
return JSON.parse(raw);
} catch (_) {
console.warn("TinyCart: invalid data-tc-config JSON.");
return {};
}
}

function init(config = {}) {
s.c = { ...D, ...readScriptConfig(), ...config };
s.c.cartKey = str(s.c.cartKey || "default", 80);
s.c.currency = str(s.c.currency || "USD", 8).toUpperCase();
s.c.locale = str(s.c.locale || "", 40);
s.c.accent = s.c.accent && /^#[0-9a-f]{3,8}$/i.test(s.c.accent) ? readableAccent(s.c.accent) : "";
s.c.apiKey = str(s.c.apiKey || "", 300);
s.c.catalogUrl = str(s.c.catalogUrl || "", 500);
s.c.paymentMethods = normalizePaymentMethods(s.c.paymentMethods);
s.c.defaultPaymentMethod = resolveDefaultPaymentMethod(s.c.paymentMethods, s.c.defaultPaymentMethod);
s.c.maxItems = clamp(int(s.c.maxItems, 10) || D.maxItems, 1, 250);
s.c.maxStorageBytes = clamp(int(s.c.maxStorageBytes, 10) || D.maxStorageBytes, 4096, 200 * 1024);
s.c.maxQueueItems = clamp(int(s.c.maxQueueItems, 10) || D.maxQueueItems, 1, 50);
s.c.maxQueueBytes = clamp(int(s.c.maxQueueBytes, 10) || D.maxQueueBytes, 2048, 80 * 1024);
s.c.queueRetentionMs = clamp(int(s.c.queueRetentionMs, 10) || D.queueRetentionMs, 60 * 1000, 7 * 24 * 60 * 60 * 1000);
s.c.retryBaseMs = clamp(int(s.c.retryBaseMs, 10) || D.retryBaseMs, 500, 30 * 1000);

loadCart();
if (doc.body) {
buildUI();
bindProductListeners();
render();
hydrateCatalog();
scheduleFlushQueue();
s.initialized = true;
} else {
doc.addEventListener("DOMContentLoaded", () => init(config), { once: true });
}
return api;
}

// Public API: init, add, remove, update, getCart, clear, applyCoupon, htmlEscape, safeTemplate, flushQueue, on
const api = {
init,
add,
remove,
update,
getCart,
clear,
applyCoupon,
htmlEscape,
safeTemplate,
flushQueue,
on(eventName, handler) {
if (typeof handler !== "function") return () => {};
s.h[eventName] = s.h[eventName] || [];
s.h[eventName].push(handler);
return () => {
  s.h[eventName] = (s.h[eventName] || []).filter((candidate) => candidate !== handler);
};
}
};

win.tinycart = api;

win.addEventListener("pagehide", () => {
const cart = getCart();
if (cart.totals.count > 0) ping("cart_snapshot", { count: cart.totals.count, total: cart.totals.totalCents });
});
win.addEventListener("online", flushQueue);

const boot = () => init();
if (doc.readyState === "loading") {
doc.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
boot();
}
})(window, document);
