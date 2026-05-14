/*!
 * TinyCart MVP
 * Dependency-free embeddable storefront cart.
 *
 * Embed:
 * <script src="tinycart.js" data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/checkout.php","accent":"#1A73E8"}'></script>
 *
 * Developer API: tinycart.init, tinycart.add, tinycart.remove, tinycart.update,
 * tinycart.getCart, tinycart.clear, tinycart.on
 */
(function (win, doc) {
  "use strict";

  const DEFAULTS = {
    cartKey: "default",
    currency: "USD",
    apiCheckout: "/checkout.php",
    apiCoupon: null,
    analyticsUrl: null,
    accent: "#111111",
    coupons: {},
    maxItems: 100,
    maxStorageBytes: 50 * 1024,
    onCheckout: null,
    onValidateCoupon: null
  };

  const state = {
    config: { ...DEFAULTS },
    items: [],
    coupon: null,
    handlers: {},
    initialized: false,
    root: null,
    floating: null,
    modal: null,
    list: null,
    count: null,
    total: null,
    modalTotal: null,
    discount: null,
    toast: null,
    form: null,
    couponInput: null,
    couponStatus: null,
    lastFocused: null
  };

  const selectors = "[data-tc-id][data-tc-name][data-tc-price]";
  const storageKey = () => `tinycart:${state.config.cartKey || "default"}`;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const now = () => Date.now();

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

  function safeString(value, max = 180) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  }

  function safeEmail(value) {
    const email = safeString(value, 254);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
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
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: state.config.currency || "USD"
      }).format(centsToDecimal(cents));
    } catch (_) {
      return `${state.config.currency || "USD"} ${centsToDecimal(cents).toFixed(2)}`;
    }
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function itemKey(item) {
    return `${safeString(item.id, 120)}::${stableStringify(item.options || {})}`;
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
    (state.handlers[eventName] || []).slice().forEach((handler) => {
      try { handler(detail); } catch (err) { win.setTimeout(() => { throw err; }); }
    });
    try {
      doc.dispatchEvent(new CustomEvent(`tinycart:${eventName}`, { detail }));
    } catch (_) {}
  }

  function loadCart() {
    try {
      const raw = win.localStorage.getItem(storageKey());
      if (!raw || raw.length > state.config.maxStorageBytes) return;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.items)) return;
      state.items = saved.items.map(normalizeItem).filter(Boolean).slice(0, state.config.maxItems);
      state.coupon = normalizeCoupon(saved.coupon);
    } catch (_) {
      state.items = [];
      state.coupon = null;
    }
  }

  function saveCart() {
    const payload = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      coupon: state.coupon,
      items: state.items.slice(0, state.config.maxItems)
    });
    if (payload.length > state.config.maxStorageBytes) {
      toast("Cart is too large. Remove an item before adding more.");
      return false;
    }
    try {
      win.localStorage.setItem(storageKey(), payload);
      return true;
    } catch (_) {
      toast("Cart could not be saved in this browser.");
      return false;
    }
  }

  function normalizeCoupon(coupon) {
    if (!coupon || typeof coupon !== "object") return null;
    const code = safeString(coupon.code, 40).toUpperCase();
    if (!code) return null;
    const type = coupon.type === "fixed" ? "fixed" : "percent";
    const value = Math.max(0, Number(coupon.value || 0));
    const amount = Math.max(0, Number(coupon.amount || 0));
    return { code, type, value, amount, server: !!coupon.server };
  }

  function normalizeItem(input) {
    if (!input || typeof input !== "object") return null;
    const id = safeString(input.id || input.itemId, 120);
    const name = safeString(input.name, 180);
    const cents = Number.isInteger(input.priceCents) ? input.priceCents : toCents(input.price);
    const stock = input.stock === "" || input.stock == null ? null : Math.max(0, Number.parseInt(input.stock, 10));
    const qty = clamp(Number.parseInt(input.qty || 1, 10) || 1, 1, stock || 999);
    if (!id || !name || !Number.isFinite(cents) || cents < 0) return null;
    const options = input.options && typeof input.options === "object" ? JSON.parse(JSON.stringify(input.options)) : {};
    const sig = safeString(input.sig || input.signature || "", 512);
    const exp = safeString(input.exp || input.expires || "", 40);
    return {
      key: itemKey({ id, options }),
      id,
      name,
      priceCents: cents,
      qty,
      options,
      stock,
      sig,
      exp
    };
  }

  function totals() {
    const subtotal = state.items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
    const discount = state.coupon ? clamp(Math.round(Number(state.coupon.amount || 0)), 0, subtotal) : 0;
    return {
      count: state.items.reduce((sum, item) => sum + item.qty, 0),
      subtotal,
      discount,
      total: Math.max(0, subtotal - discount)
    };
  }

  function recalcCoupon() {
    if (!state.coupon) return;
    const subtotal = state.items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
    if (state.coupon.type === "fixed") {
      state.coupon.amount = clamp(Math.round(Number(state.coupon.value) * 100), 0, subtotal);
    } else {
      state.coupon.amount = clamp(Math.round(subtotal * (Number(state.coupon.value) / 100)), 0, subtotal);
    }
  }

  function add(input) {
    const item = normalizeItem(input);
    if (!item) {
      toast("This product cannot be added.");
      return false;
    }
    const existing = state.items.find((candidate) => candidate.key === item.key);
    if (existing) {
      existing.qty = clamp(existing.qty + item.qty, 1, existing.stock || 999);
    } else {
      if (state.items.length >= state.config.maxItems) {
        toast("Cart item limit reached.");
        return false;
      }
      state.items.push(item);
    }
    changed();
    toast(`${item.name} added`);
    pulseCart();
    return true;
  }

  function remove(itemId) {
    const before = state.items.length;
    state.items = state.items.filter((item) => item.key !== itemId && item.id !== itemId);
    if (state.items.length !== before) changed();
  }

  function update(itemId, patch = {}) {
    const item = state.items.find((candidate) => candidate.key === itemId || candidate.id === itemId);
    if (!item) return;
    if (patch.qty != null) {
      const nextQty = Number.parseInt(patch.qty, 10);
      if (!Number.isFinite(nextQty) || nextQty <= 0) {
        remove(item.key);
        return;
      }
      item.qty = clamp(nextQty, 1, item.stock || 999);
    }
    changed();
  }

  function clear() {
    state.items = [];
    state.coupon = null;
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
      cartKey: state.config.cartKey,
      currency: state.config.currency,
      items: state.items.map((item) => ({
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
      coupon: state.coupon,
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
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      toast("Product options are invalid JSON.");
      return {};
    }
  }

  function itemFromElement(el) {
    return {
      id: el.getAttribute("data-tc-id"),
      name: el.getAttribute("data-tc-name"),
      price: el.getAttribute("data-tc-price"),
      qty: el.getAttribute("data-tc-qty") || 1,
      options: parseOptions(el.getAttribute("data-tc-options")),
      stock: el.getAttribute("data-tc-stock"),
      sig: el.getAttribute("data-tc-sig"),
      exp: el.getAttribute("data-tc-exp")
    };
  }

  function onProductClick(event) {
    const trigger = event.target.closest ? event.target.closest(selectors) : null;
    if (!trigger) return;
    add(itemFromElement(trigger));
  }

  function onProductKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const trigger = event.target.closest ? event.target.closest(selectors) : null;
    if (!trigger) return;
    event.preventDefault();
    add(itemFromElement(trigger));
  }

  function create(tag, className, text) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text != null) setText(el, text);
    return el;
  }

  function injectStyles() {
    if (doc.getElementById("tinycart-style")) return;
    const style = create("style");
    style.id = "tinycart-style";
    style.textContent = `
.tc-root{--tc-accent:#111;--tc-bg:#fff;--tc-fg:#080808;--tc-muted:#666;--tc-line:#e7e7e7;--tc-soft:#f7f7f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--tc-fg)}
.tc-root *{box-sizing:border-box}
.tc-float{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:10px;min-height:52px;padding:0 18px;border:1px solid #111;border-radius:999px;background:#111;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,.18);font:700 15px/1 Inter,system-ui,sans-serif;cursor:pointer;touch-action:manipulation;transition:transform .18s ease,background .18s ease}
.tc-float:hover,.tc-float:focus-visible{background:var(--tc-accent);outline:2px solid transparent;transform:translateY(-1px)}
.tc-float.tc-pulse{animation:tc-pop .28s ease}
.tc-count{display:grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;background:#fff;color:#111;font-size:12px}
.tc-backdrop{position:fixed;inset:0;z-index:2147483001;display:none;background:rgba(0,0,0,.42);padding:0}
.tc-backdrop[aria-hidden=false]{display:block}
.tc-dialog{position:absolute;inset:auto 0 0 0;max-height:92dvh;display:flex;flex-direction:column;background:#fff;border-radius:18px 18px 0 0;box-shadow:0 -24px 80px rgba(0,0,0,.24);overflow:hidden}
.tc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 18px 12px;border-bottom:1px solid var(--tc-line)}
.tc-title{margin:0;font-size:18px;line-height:1.2;font-weight:800;letter-spacing:0}
.tc-iconbtn{display:grid;place-items:center;width:44px;height:44px;border:1px solid var(--tc-line);border-radius:999px;background:#fff;color:#111;cursor:pointer}
.tc-iconbtn:hover,.tc-iconbtn:focus-visible{border-color:#111;outline:2px solid var(--tc-accent);outline-offset:2px}
.tc-body{overflow:auto;padding:10px 18px 18px}
.tc-empty{padding:36px 0;color:var(--tc-muted);text-align:center;font-size:15px}
.tc-item{display:grid;grid-template-columns:1fr auto;gap:12px;padding:16px 0;border-bottom:1px solid var(--tc-line)}
.tc-name{font-weight:750;font-size:15px;line-height:1.25}
.tc-options{margin-top:5px;color:var(--tc-muted);font-size:12px;line-height:1.35;word-break:break-word}
.tc-price{margin-top:8px;font-weight:700;font-size:14px}
.tc-row-actions{display:flex;align-items:center;gap:8px;margin-top:12px}
.tc-qty{display:flex;align-items:center;border:1px solid var(--tc-line);border-radius:999px;overflow:hidden}
.tc-qty button{width:38px;height:38px;border:0;background:#fff;font-size:20px;line-height:1;cursor:pointer}
.tc-qty input{width:48px;height:38px;border:0;border-inline:1px solid var(--tc-line);text-align:center;font:700 15px/1 Inter,system-ui,sans-serif}
.tc-qty button:hover,.tc-remove:hover{background:var(--tc-soft)}
.tc-remove{height:38px;border:1px solid var(--tc-line);border-radius:999px;background:#fff;padding:0 12px;cursor:pointer;color:#111;font-weight:650}
.tc-line{display:flex;justify-content:space-between;gap:16px;padding:6px 0;color:var(--tc-muted);font-size:14px}
.tc-line strong{color:#111}
.tc-coupon{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:14px}
.tc-input,.tc-field input,.tc-field textarea{width:100%;min-height:46px;border:1px solid var(--tc-line);border-radius:10px;background:#fff;color:#111;padding:11px 12px;font:500 15px/1.3 Inter,system-ui,sans-serif}
.tc-field textarea{min-height:74px;resize:vertical}
.tc-input:focus,.tc-field input:focus,.tc-field textarea:focus{outline:2px solid var(--tc-accent);outline-offset:1px}
.tc-btn{min-height:46px;border:1px solid #111;border-radius:999px;background:#111;color:#fff;padding:0 16px;font:800 14px/1 Inter,system-ui,sans-serif;cursor:pointer}
.tc-btn:hover,.tc-btn:focus-visible{background:var(--tc-accent);outline:2px solid transparent}
.tc-btn[disabled]{opacity:.55;cursor:not-allowed}
.tc-coupon-status{min-height:18px;margin:7px 0 0;color:var(--tc-muted);font-size:12px}
.tc-form{display:grid;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid var(--tc-line)}
.tc-field span{display:block;margin:0 0 6px;font-size:12px;font-weight:750;color:#333}
.tc-foot{padding:14px 18px 18px;border-top:1px solid var(--tc-line);background:#fff}
.tc-toast{position:fixed;left:16px;right:16px;bottom:80px;z-index:2147483002;display:none;padding:13px 14px;border:1px solid #111;border-radius:12px;background:#111;color:#fff;text-align:center;font:700 14px/1.35 Inter,system-ui,sans-serif;box-shadow:0 14px 42px rgba(0,0,0,.2)}
.tc-toast[aria-hidden=false]{display:block;animation:tc-slide .2s ease}
.tc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media (min-width:720px){.tc-float{right:24px;bottom:24px}.tc-dialog{inset:32px 32px 32px auto;width:min(440px,calc(100vw - 64px));max-height:none;border-radius:18px}.tc-toast{left:auto;right:24px;bottom:92px;width:320px}.tc-body{padding-inline:20px}.tc-head,.tc-foot{padding-inline:20px}}
@media (prefers-reduced-motion:reduce){.tc-float,.tc-toast{transition:none;animation:none!important}}
@keyframes tc-pop{50%{transform:scale(1.04)}}
@keyframes tc-slide{from{transform:translateY(8px);opacity:.2}to{transform:translateY(0);opacity:1}}
`;
    doc.head.appendChild(style);
  }

  function buildUI() {
    injectStyles();
    if (state.root) state.root.remove();

    const root = create("div", "tc-root");
    root.style.setProperty("--tc-accent", state.config.accent || "#111111");

    const float = create("button", "tc-float");
    float.type = "button";
    float.setAttribute("aria-label", "Open cart");
    float.append(create("span", "", "Cart"));
    const count = create("span", "tc-count", "0");
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
    const title = create("h2", "tc-title", "Your cart");
    title.id = "tc-title";
    const close = create("button", "tc-iconbtn", "x");
    close.type = "button";
    close.setAttribute("aria-label", "Close cart");
    close.addEventListener("click", closeCart);
    head.append(title, close);

    const body = create("div", "tc-body");
    const list = create("div", "tc-list");
    body.append(list);

    const coupon = create("div");
    coupon.className = "tc-coupon";
    const couponInput = create("input", "tc-input");
    couponInput.type = "text";
    couponInput.autocomplete = "off";
    couponInput.placeholder = "Coupon code";
    couponInput.setAttribute("aria-label", "Coupon code");
    const couponButton = create("button", "tc-btn", "Apply");
    couponButton.type = "button";
    couponButton.addEventListener("click", () => applyCoupon(couponInput.value));
    coupon.append(couponInput, couponButton);
    const couponStatus = create("div", "tc-coupon-status");
    couponStatus.setAttribute("aria-live", "polite");
    body.append(coupon, couponStatus);

    const form = create("form", "tc-form");
    form.noValidate = true;
    form.append(
      field("Name", "name", "text", true),
      field("Phone", "phone", "tel", true),
      field("Email", "email", "email", false),
      field("Address", "address", "textarea", true)
    );
    form.addEventListener("submit", checkout);
    body.append(form);

    const foot = create("div", "tc-foot");
    const subtotalLine = create("div", "tc-line");
    subtotalLine.append(create("span", "", "Subtotal"), create("strong", "tc-total", money(0)));
    const discountLine = create("div", "tc-line");
    discountLine.append(create("span", "", "Discount"), create("strong", "tc-discount", money(0)));
    const totalLine = create("div", "tc-line");
    totalLine.append(create("span", "", "Total"), create("strong", "tc-modal-total", money(0)));
    const submit = create("button", "tc-btn", "Checkout");
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

    state.root = root;
    state.floating = float;
    state.modal = backdrop;
    state.list = list;
    state.count = count;
    state.total = subtotalLine.querySelector(".tc-total");
    state.discount = discountLine.querySelector(".tc-discount");
    state.modalTotal = totalLine.querySelector(".tc-modal-total");
    state.toast = toastEl;
    state.form = form;
    state.couponInput = couponInput;
    state.couponStatus = couponStatus;
  }

  function field(label, name, type, required) {
    const wrap = create("label", "tc-field");
    const span = create("span", "", label);
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
    wrap.append(span, input);
    return wrap;
  }

  function render() {
    if (!state.root) return;
    const sum = totals();
    setText(state.count, sum.count);
    setText(state.total, money(sum.subtotal));
    setText(state.discount, `-${money(sum.discount)}`);
    setText(state.modalTotal, money(sum.total));
    if (state.couponInput && state.coupon && state.couponInput.value.toUpperCase() !== state.coupon.code) {
      state.couponInput.value = state.coupon.code;
    }

    state.list.replaceChildren();
    if (!state.items.length) {
      state.list.append(create("div", "tc-empty", "Your cart is empty."));
      return;
    }

    state.items.forEach((item) => {
      const row = create("article", "tc-item");
      const main = create("div");
      main.append(create("div", "tc-name", item.name));
      const optionText = optionsLabel(item.options);
      if (optionText) main.append(create("div", "tc-options", optionText));
      main.append(create("div", "tc-price", money(item.priceCents)));

      const actions = create("div", "tc-row-actions");
      const qty = create("div", "tc-qty");
      const minus = create("button", "", "-");
      minus.type = "button";
      minus.setAttribute("aria-label", `Decrease ${item.name} quantity`);
      const input = create("input");
      input.type = "number";
      input.min = "1";
      input.step = "1";
      input.inputMode = "numeric";
      input.value = String(item.qty);
      input.setAttribute("aria-label", `Quantity for ${item.name}`);
      if (item.stock) input.max = String(item.stock);
      const plus = create("button", "", "+");
      plus.type = "button";
      plus.setAttribute("aria-label", `Increase ${item.name} quantity`);
      const delayedUpdate = debounce(() => update(item.key, { qty: input.value }), 250);
      minus.addEventListener("click", () => update(item.key, { qty: item.qty - 1 }));
      plus.addEventListener("click", () => update(item.key, { qty: item.qty + 1 }));
      input.addEventListener("input", delayedUpdate);
      qty.append(minus, input, plus);
      const removeBtn = create("button", "tc-remove", "Remove");
      removeBtn.type = "button";
      removeBtn.addEventListener("click", () => remove(item.key));
      actions.append(qty, removeBtn);
      main.append(actions);

      const lineTotal = create("strong", "", money(item.priceCents * item.qty));
      row.append(main, lineTotal);
      state.list.append(row);
    });
  }

  const scheduleRender = throttle(render, 60);

  function optionsLabel(options) {
    if (!options || typeof options !== "object") return "";
    return Object.keys(options).sort().map((key) => `${key}: ${String(options[key])}`).join(", ");
  }

  async function applyCoupon(rawCode) {
    const code = safeString(rawCode, 40).toUpperCase();
    if (!code) {
      state.coupon = null;
      setText(state.couponStatus, "Coupon removed.");
      changed();
      emit("cart:applyCoupon", { code: "", ok: true, removed: true });
      return;
    }

    setText(state.couponStatus, "Checking coupon...");
    let result = null;
    try {
      if (typeof state.config.onValidateCoupon === "function") {
        result = await state.config.onValidateCoupon(code, getCart());
      } else if (state.config.apiCoupon) {
        const response = await win.fetch(state.config.apiCoupon, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ code, cart: getCart() })
        });
        result = await response.json();
      } else if (state.config.coupons && state.config.coupons[code]) {
        const local = state.config.coupons[code];
        result = typeof local === "number" ? { ok: true, type: "percent", value: local } : { ok: true, ...local };
      }
    } catch (_) {
      result = { ok: false, message: "Coupon validation failed." };
    }

    if (!result || result.ok === false) {
      state.coupon = null;
      setText(state.couponStatus, safeString(result && result.message ? result.message : "Coupon not valid.", 120));
      changed();
      emit("cart:applyCoupon", { code, ok: false });
      return;
    }

    state.coupon = normalizeCoupon({
      code,
      type: result.type === "fixed" ? "fixed" : "percent",
      value: Number(result.value || 0),
      server: !!(state.config.apiCoupon || state.config.onValidateCoupon)
    });
    recalcCoupon();
    setText(state.couponStatus, `${state.coupon.code} applied.`);
    changed();
    emit("cart:applyCoupon", { code, ok: true, coupon: state.coupon });
  }

  function formData() {
    const data = new FormData(state.form);
    return {
      name: safeString(data.get("name"), 120),
      phone: safeString(data.get("phone"), 40),
      email: safeEmail(data.get("email")),
      address: safeString(data.get("address"), 500)
    };
  }

  async function checkout(event) {
    event.preventDefault();
    if (!state.items.length) {
      toast("Add an item before checkout.");
      return;
    }
    if (!state.form.reportValidity()) return;

    const customer = formData();
    if (!customer.name || !customer.phone || !customer.address) {
      toast("Please complete required fields.");
      return;
    }

    const submit = state.form.ownerDocument.querySelector('button[form="tc-checkout-form"]');
    if (submit) submit.disabled = true;
    const payload = {
      cartKey: state.config.cartKey,
      currency: state.config.currency,
      customer,
      cart: getCart(),
      page: win.location.href,
      createdAt: new Date().toISOString()
    };

    try {
      let result;
      if (typeof state.config.onCheckout === "function") {
        result = await state.config.onCheckout(payload);
      } else {
        const response = await win.fetch(state.config.apiCheckout, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload)
        });
        result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Checkout failed");
      }

      emit("cart:checkedout", { order: result, cart: getCart() });
      ping("checkout", { order_id: result && result.order_id, total: getCart().totals.totalCents });
      toast("Order received.");
      clear();
      closeCart();
      if (result && result.pay_url) win.location.assign(result.pay_url);
    } catch (err) {
      toast(safeString(err && err.message ? err.message : "Checkout failed. Try again.", 120));
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function openCart() {
    if (!state.modal) return;
    state.lastFocused = doc.activeElement;
    state.modal.setAttribute("aria-hidden", "false");
    doc.addEventListener("keydown", trapKeys, true);
    const first = state.modal.querySelector("button,input,textarea,[tabindex]:not([tabindex='-1'])");
    if (first) first.focus();
    emit("cart:opened", getCart());
  }

  function closeCart() {
    if (!state.modal) return;
    state.modal.setAttribute("aria-hidden", "true");
    doc.removeEventListener("keydown", trapKeys, true);
    if (state.lastFocused && state.lastFocused.focus) state.lastFocused.focus();
  }

  function trapKeys(event) {
    if (event.key === "Escape") {
      closeCart();
      return;
    }
    if (event.key !== "Tab" || state.modal.getAttribute("aria-hidden") === "true") return;
    const focusable = Array.from(state.modal.querySelectorAll("button,input,textarea,[href],[tabindex]:not([tabindex='-1'])"))
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
    if (!state.toast) return;
    setText(state.toast, message);
    state.toast.setAttribute("aria-hidden", "false");
    win.clearTimeout(state.toast._timer);
    state.toast._timer = win.setTimeout(() => state.toast.setAttribute("aria-hidden", "true"), 2400);
  }

  function pulseCart() {
    if (!state.floating) return;
    state.floating.classList.remove("tc-pulse");
    void state.floating.offsetWidth;
    state.floating.classList.add("tc-pulse");
  }

  function ping(type, payload = {}) {
    if (!state.config.analyticsUrl) return;
    const body = JSON.stringify({
      type,
      cartKey: state.config.cartKey,
      currency: state.config.currency,
      payload,
      ts: new Date().toISOString()
    });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(state.config.analyticsUrl, blob)) return;
      }
    } catch (_) {}
    try {
      win.fetch(state.config.analyticsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin"
      }).catch(() => {});
    } catch (_) {}
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
    state.config = { ...DEFAULTS, ...readScriptConfig(), ...config };
    state.config.cartKey = safeString(state.config.cartKey || "default", 80);
    state.config.currency = safeString(state.config.currency || "USD", 8).toUpperCase();
    state.config.accent = /^#[0-9a-f]{3,8}$/i.test(state.config.accent) ? state.config.accent : "#111111";
    state.config.maxItems = clamp(Number.parseInt(state.config.maxItems, 10) || DEFAULTS.maxItems, 1, 250);
    state.config.maxStorageBytes = clamp(Number.parseInt(state.config.maxStorageBytes, 10) || DEFAULTS.maxStorageBytes, 4096, 200 * 1024);

    loadCart();
    if (doc.body) {
      buildUI();
      bindProductListeners();
      render();
      state.initialized = true;
    } else {
      doc.addEventListener("DOMContentLoaded", () => init(config), { once: true });
    }
    return api;
  }

  const api = {
    init,
    add,
    remove,
    update,
    getCart,
    clear,
    applyCoupon,
    htmlEscape,
    on(eventName, handler) {
      if (typeof handler !== "function") return () => {};
      state.handlers[eventName] = state.handlers[eventName] || [];
      state.handlers[eventName].push(handler);
      return () => {
        state.handlers[eventName] = (state.handlers[eventName] || []).filter((candidate) => candidate !== handler);
      };
    }
  };

  win.tinycart = api;

  win.addEventListener("pagehide", () => {
    const cart = getCart();
    if (cart.totals.count > 0) ping("cart_snapshot", { count: cart.totals.count, total: cart.totals.totalCents });
  });

  const boot = () => init();
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window, document);
