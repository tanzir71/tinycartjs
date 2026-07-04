import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const origin = "http://127.0.0.1:8000";

async function withServer(run) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-endpoints-"));
  for (const file of ["checkout.php", "collect.php", "coupon.php", "catalog.php"]) {
    assert.ok(existsSync(join(root, file)), `${file} should exist`);
    copyFileSync(join(root, file), join(fixture, file));
  }
  if (existsSync(join(root, "admin.php"))) {
    copyFileSync(join(root, "admin.php"), join(fixture, "admin.php"));
  }

  const port = 18_000 + Math.floor(Math.random() * 1000);
  const server = spawn("php", ["-S", `127.0.0.1:${port}`], {
    cwd: fixture,
    stdio: ["ignore", "ignore", "pipe"]
  });
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(base);
    await run(base);
  } finally {
    await stopServer(server);
    rmSync(fixture, { recursive: true, force: true });
  }
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    server.once("exit", resolve);
    server.kill();
    setTimeout(resolve, 1000);
  });
}

async function waitForServer(base) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      await fetch(`${base}/checkout.php`, { method: "OPTIONS", headers: { Origin: origin } });
      return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("PHP test server did not start");
}

async function postJson(base, path, payload) {
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return [response, await response.json()];
}

async function postRaw(base, path, body, requestOrigin = origin) {
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json"
    },
    body
  });
  return [response, await response.json()];
}

function checkoutPayload(coupon) {
  return {
    cartKey: "demo-store",
    currency: "USD",
    customer: {
      name: "Ada Lovelace",
      phone: "+15551234567",
      email: "ada@example.com",
      address: "1 Byte Lane"
    },
    cart: {
      items: [
        {
          id: "tee-001",
          name: "Forged Name",
          priceCents: 2400,
          qty: 1,
          options: { size: "M" }
        }
      ],
      coupon,
      totals: {
        subtotalCents: 2400,
        discountCents: coupon ? coupon.amount : 0,
        totalCents: coupon ? 2400 - coupon.amount : 2400
      }
    },
    page: "http://127.0.0.1:8000/sample.html"
  };
}

test("coupon endpoint validates active, invalid, and expired coupons", async () => {
  await withServer(async (base) => {
    const [, active] = await postJson(base, "coupon.php", {
      code: "SAVE10",
      cart: { totals: { subtotalCents: 2400 } }
    });
    assert.equal(active.ok, true);
    assert.equal(active.code, "SAVE10");
    assert.equal(active.type, "percent");
    assert.equal(active.value, 10);
    assert.equal(active.discount_cents, 240);

    const [invalidResponse, invalid] = await postJson(base, "coupon.php", {
      code: "NOPE",
      cart: { totals: { subtotalCents: 2400 } }
    });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(invalid, { ok: false, error: "Coupon not valid." });

    const [expiredResponse, expired] = await postJson(base, "coupon.php", {
      code: "EXPIRED",
      cart: { totals: { subtotalCents: 2400 } }
    });
    assert.equal(expiredResponse.status, 400);
    assert.deepEqual(expired, { ok: false, error: "Coupon expired." });
  });
});

test("checkout recomputes coupon discounts and ignores forged coupons", async () => {
  const valid = validateCheckoutPayload(checkoutPayload({
      code: "SAVE10",
      type: "percent",
      value: 10,
      amount: 240
  }));
  assert.equal(valid.subtotal_cents, 2400);
  assert.equal(valid.discount_cents, 240);
  assert.equal(valid.total_cents, 2160);
  assert.equal(valid.coupon_code, "SAVE10");

  const forged = validateCheckoutPayload(checkoutPayload({
      code: "FAKE100",
      type: "percent",
      value: 100,
      amount: 2400
  }));
  assert.equal(forged.subtotal_cents, 2400);
  assert.equal(forged.discount_cents, 0);
  assert.equal(forged.total_cents, 2400);
  assert.equal(forged.coupon_code, null);
});

test("checkout rejects price tampering before storing orders", () => {
  assert.throws(
    () => validateCheckoutPayload({
      ...checkoutPayload(null),
      cart: {
        items: [
          {
            id: "tee-001",
            name: "TinyCart Tee",
            priceCents: 1,
            qty: 1,
            options: {}
          }
        ],
        totals: { subtotalCents: 1 }
      }
    }),
    /price mismatch/
  );
});

test("inventory reservation decrements stock atomically and rejects oversell", () => {
  const success = runCheckoutSnippet(`
class FakeStatement {
    public array $rows;
    public int $index = 0;
    public array $params = [];
    public function __construct(array $rows) { $this->rows = $rows; }
    public function execute(array $params): void { $this->params[] = $params; }
    public function rowCount(): int { return $this->rows[$this->index++] ?? 0; }
}
class FakePdo {
    public FakeStatement $statement;
    public function __construct(array $rows) { $this->statement = new FakeStatement($rows); }
    public function prepare(string $sql): FakeStatement { return $this->statement; }
}
$pdo = new FakePdo([1]);
reserveInventory($pdo, [['id' => 'tee-001', 'qty' => 2]]);
echo json_encode($pdo->statement->params, JSON_UNESCAPED_SLASHES);
`, {});
  assert.equal(success[0][":product_id"], "tee-001");
  assert.equal(success[0][":qty"], 2);

  assert.throws(
    () => runCheckoutSnippet(`
class FakeStatement {
    public function execute(array $params): void {}
    public function rowCount(): int { return 0; }
}
class FakePdo {
    public function prepare(string $sql): FakeStatement { return new FakeStatement(); }
}
reserveInventory(new FakePdo(), [['id' => 'tee-001', 'qty' => 2]]);
echo json_encode(['ok' => true]);
`, {}),
    /Out of stock/
  );
});

test("order webhook posts a signed PII-free summary", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$calls = [];
dispatchOrderNotifications(null, 'TWEBHOOK123', $order, function ($method, $url, $headers, $body) use (&$calls) {
    $calls[] = compact('method', 'url', 'headers', 'body');
    return ['status' => 204, 'body' => ''];
});
echo json_encode($calls[0], JSON_UNESCAPED_SLASHES);
`, checkoutPayload({
    code: "SAVE10",
    type: "percent",
    value: 10,
    amount: 240
  }), [
    ["const WEBHOOK_URL = '';", "const WEBHOOK_URL = 'https://hooks.example/order';"],
    ["const WEBHOOK_SECRET = '';", "const WEBHOOK_SECRET = 'hook-secret';"]
  ]);
  const payload = JSON.parse(result.body);

  assert.equal(result.method, "POST");
  assert.equal(result.url, "https://hooks.example/order");
  assert.equal(result.headers["X-TinyCart-Signature"], hmac(result.body, "hook-secret"));
  assert.equal(payload.order_id, "TWEBHOOK123");
  assert.equal(payload.total_cents, 2160);
  assert.equal(payload.items[0].id, "tee-001");
  assert.equal(payload.customer, undefined);
});

test("webhook failure is queued and does not block checkout", () => {
  const result = runCheckoutSnippet(`
class FakeStatement {
    public array $params = [];
    public function execute(array $params): void { $this->params = $params; }
}
class FakePdo {
    public string $sql = '';
    public FakeStatement $statement;
    public function prepare(string $sql): FakeStatement {
        $this->sql = $sql;
        $this->statement = new FakeStatement();
        return $this->statement;
    }
}
$order = validateOrderPayload($payload);
$pdo = new FakePdo();
dispatchOrderNotifications($pdo, 'TWEBHOOKFAIL', $order, function () {
    throw new RuntimeException('network down');
});
echo json_encode(['sql' => $pdo->sql, 'params' => $pdo->statement->params], JSON_UNESCAPED_SLASHES);
`, checkoutPayload(null), [
    ["const WEBHOOK_URL = '';", "const WEBHOOK_URL = 'https://hooks.example/order';"],
    ["const WEBHOOK_SECRET = '';", "const WEBHOOK_SECRET = 'hook-secret';"]
  ]);

  assert.match(result.sql, /webhook_deliveries/);
  assert.equal(result.params[":order_id"], "TWEBHOOKFAIL");
  assert.equal(result.params[":status"], "pending");
});

test("checkout and coupon endpoints reject disallowed origins", async () => {
  await withServer(async (base) => {
    for (const path of ["checkout.php", "coupon.php"]) {
      const [response, payload] = await postRaw(base, path, JSON.stringify({ cart: { items: [] }, customer: {} }), "https://evil.example");

      assert.equal(response.status, 403);
      assert.deepEqual(payload, { ok: false, error: "Origin not allowed" });
    }
  });
});

test("catalog endpoint serves cacheable server product truth", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/catalog.php`, {
      headers: { Origin: origin }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(response.headers.get("Cache-Control"), /max-age=60/);
    assert.equal(payload.ok, true);
    assert.equal(payload.items.find((item) => item.id === "tee-001").price_cents, 2400);
  });
});

test("catalog endpoint rejects disallowed origins", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/catalog.php`, {
      headers: { Origin: "https://evil.example" }
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.deepEqual(payload, { ok: false, error: "Origin not allowed" });
  });
});

test("admin view refuses unauthenticated access by default", async () => {
  assert.ok(existsSync(join(root, "admin.php")), "admin.php should exist");
  await withServer(async (base) => {
    const response = await fetch(`${base}/admin.php`, {
      headers: { Origin: origin }
    });
    const body = await response.text();

    assert.equal(response.status, 403);
    assert.match(body, /not configured/i);
  });
});

test("admin auth accepts configured API keys and rejects wrong keys", () => {
  const accepted = runAdminSnippet(`
$_SERVER['HTTP_X_API_KEY'] = 'admin-test-key';
requireAdminAuth();
echo json_encode(['ok' => true], JSON_UNESCAPED_SLASHES);
`, [
    ["const ADMIN_API_KEYS = [];", "const ADMIN_API_KEYS = ['admin-test-key'];"]
  ]);
  assert.deepEqual(accepted, { ok: true });

  assert.throws(
    () => runAdminSnippet(`
$_SERVER['HTTP_X_API_KEY'] = 'wrong-key';
requireAdminAuth();
echo json_encode(['ok' => true], JSON_UNESCAPED_SLASHES);
`, [
      ["const ADMIN_API_KEYS = [];", "const ADMIN_API_KEYS = ['admin-test-key'];"]
    ]),
    /Unauthorized/
  );
});

test("admin view lists orders with totals, pagination, and escaped output", () => {
  const result = runAdminSnippet(`
class FakeStatement {
    public array $params = [];
    public function execute(array $params): void { $this->params = $params; }
    public function fetchAll(): array {
        return [
            [
                'id' => 'T<script>alert(1)</script>',
                'created_at' => '2026-07-04T00:00:00+00:00',
                'currency' => 'USD',
                'subtotal_cents' => 2400,
                'discount_cents' => 240,
                'total_cents' => 2160,
                'coupon_code' => 'SAVE10',
                'payment_status' => 'pending',
                'payment_provider' => null,
                'customer_name' => '<img src=x onerror=alert(1)>',
                'customer_email' => 'ada@example.com'
            ],
            [
                'id' => 'TNEXT',
                'created_at' => '2026-07-04T00:01:00+00:00',
                'currency' => 'USD',
                'subtotal_cents' => 700,
                'discount_cents' => 0,
                'total_cents' => 700,
                'coupon_code' => null,
                'payment_status' => 'paid',
                'payment_provider' => 'stripe',
                'customer_name' => 'Grace Hopper',
                'customer_email' => ''
            ]
        ];
    }
}
class FakePdo {
    public string $sql = '';
    public FakeStatement $statement;
    public function prepare(string $sql): FakeStatement {
        $this->sql = $sql;
        $this->statement = new FakeStatement();
        return $this->statement;
    }
}
$pdo = new FakePdo();
$listing = fetchAdminOrders($pdo, 1, 1);
$html = renderAdminPage($listing);
echo json_encode([
    'html' => $html,
    'sql' => $pdo->sql,
    'params' => $pdo->statement->params,
    'has_next' => $listing['has_next']
], JSON_UNESCAPED_SLASHES);
`);

  assert.equal(result.has_next, true);
  assert.match(result.sql, /^SELECT/i);
  assert.doesNotMatch(result.sql, /(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE TABLE)/i);
  assert.equal(result.params[":limit"], 2);
  assert.equal(result.params[":offset"], 0);
  assert.match(result.html, /21\.60 USD/);
  assert.match(result.html, /Next/);
  assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(result.html, /<script>alert/);
  assert.doesNotMatch(result.html, /<img src=x/);
});

test("checkout rate-limits repeated requests", async () => {
  await withServer(async (base) => {
    let lastResponse;
    let lastPayload;
    for (let i = 0; i < 31; i += 1) {
      [lastResponse, lastPayload] = await postRaw(base, "checkout.php", "{not json");
    }

    assert.equal(lastResponse.status, 429);
    assert.deepEqual(lastPayload, { ok: false, error: "Too many requests" });
  });
});

test("payment handoff is disabled by default", () => {
  const handoff = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$called = false;
$handoff = createPaymentHandoff($order, 'TTEST123', function () use (&$called) {
    $called = true;
    return [];
});
echo json_encode(['handoff' => $handoff, 'called' => $called], JSON_UNESCAPED_SLASHES);
`, checkoutPayload(null));

  assert.deepEqual(handoff, { handoff: null, called: false });
});

test("stripe payment handoff posts the server-recomputed total", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$requests = [];
$handoff = createPaymentHandoff($order, 'TSTRIPE123', function ($method, $url, $headers, $body) use (&$requests) {
    $requests[] = compact('method', 'url', 'headers', 'body');
    return ['status' => 200, 'body' => json_encode(['id' => 'cs_test_123', 'url' => 'https://checkout.stripe.com/c/pay/cs_test_123'])];
});
echo json_encode(['handoff' => $handoff, 'request' => $requests[0]], JSON_UNESCAPED_SLASHES);
`, checkoutPayload({
      code: "SAVE10",
      type: "percent",
      value: 10,
      amount: 240
    }), [
      ["const PAYMENT_PROVIDER = '';", "const PAYMENT_PROVIDER = 'stripe';"],
      ["const STRIPE_SECRET_KEY = '';", "const STRIPE_SECRET_KEY = 'sk_test_123';"],
      ["const PAYMENT_SUCCESS_URL = '';", "const PAYMENT_SUCCESS_URL = 'https://shop.example/success?order={ORDER_ID}';"],
      ["const PAYMENT_CANCEL_URL = '';", "const PAYMENT_CANCEL_URL = 'https://shop.example/cart';"]
    ]);

  assert.equal(result.handoff.provider, "stripe");
  assert.equal(result.handoff.session_id, "cs_test_123");
  assert.equal(result.handoff.url, "https://checkout.stripe.com/c/pay/cs_test_123");
  assert.equal(result.request.method, "POST");
  assert.match(result.request.url, /\/v1\/checkout\/sessions$/);
  const stripeBody = new URLSearchParams(result.request.body);
  assert.equal(stripeBody.get("mode"), "payment");
  assert.equal(stripeBody.get("line_items[0][price_data][unit_amount]"), "2160");
  assert.equal(stripeBody.get("client_reference_id"), "TSTRIPE123");
});

test("paypal payment handoff returns the approval URL", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$requests = [];
$handoff = createPaymentHandoff($order, 'TPAYPAL123', function ($method, $url, $headers, $body) use (&$requests) {
    $requests[] = compact('method', 'url', 'headers', 'body');
    if (str_contains($url, '/v1/oauth2/token')) {
        return ['status' => 200, 'body' => json_encode(['access_token' => 'access-token'])];
    }
    return ['status' => 201, 'body' => json_encode([
        'id' => 'PAYPAL-ORDER-123',
        'links' => [
            ['rel' => 'self', 'href' => 'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAYPAL-ORDER-123'],
            ['rel' => 'approve', 'href' => 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-123']
        ]
    ])];
});
echo json_encode(['handoff' => $handoff, 'requests' => $requests], JSON_UNESCAPED_SLASHES);
`, checkoutPayload(null), [
      ["const PAYMENT_PROVIDER = '';", "const PAYMENT_PROVIDER = 'paypal';"],
      ["const PAYPAL_CLIENT_ID = '';", "const PAYPAL_CLIENT_ID = 'client-id';"],
      ["const PAYPAL_SECRET = '';", "const PAYPAL_SECRET = 'secret';"],
      ["const PAYMENT_SUCCESS_URL = '';", "const PAYMENT_SUCCESS_URL = 'https://shop.example/paypal-return?order={ORDER_ID}';"],
      ["const PAYMENT_CANCEL_URL = '';", "const PAYMENT_CANCEL_URL = 'https://shop.example/cart';"]
    ]);

  assert.equal(result.handoff.provider, "paypal");
  assert.equal(result.handoff.session_id, "PAYPAL-ORDER-123");
  assert.equal(result.handoff.url, "https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-123");
  assert.match(result.requests[1].url, /\/v2\/checkout\/orders$/);
  assert.equal(JSON.parse(result.requests[1].body).purchase_units[0].amount.value, "24.00");
});

test("malformed JSON returns structured endpoint errors", async () => {
  await withServer(async (base) => {
    for (const path of ["checkout.php", "collect.php", "coupon.php"]) {
      const response = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json"
        },
        body: "{not json"
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /Invalid JSON/);
    }
  });
});

function validateCheckoutPayload(payload) {
  return runCheckoutSnippet(`
$order = validateOrderPayload($payload);
echo json_encode($order, JSON_UNESCAPED_SLASHES);
`, payload);
}

function runCheckoutSnippet(snippet, payload, replacements = []) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-checkout-lib-"));
  try {
    let source = readFileSync(join(root, "checkout.php"), "utf8").replace(/\nmain\(\);\n/, "\n");
    for (const [from, to] of replacements) {
      source = source.replace(from, to);
    }
    writeFileSync(join(fixture, "checkout_lib.php"), source);
    writeFileSync(join(fixture, "payload.json"), JSON.stringify(payload));
    writeFileSync(join(fixture, "run.php"), `<?php
require __DIR__ . '/checkout_lib.php';
$payload = json_decode(file_get_contents(__DIR__ . '/payload.json'), true);
${snippet}
`);

    const result = spawnSync("php", ["run.php"], {
      cwd: fixture,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function runAdminSnippet(snippet, replacements = []) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-admin-lib-"));
  try {
    let source = readFileSync(join(root, "admin.php"), "utf8").replace(/\nmain\(\);\n/, "\n");
    for (const [from, to] of replacements) {
      source = source.replace(from, to);
    }
    writeFileSync(join(fixture, "admin_lib.php"), source);
    writeFileSync(join(fixture, "run.php"), `<?php
require __DIR__ . '/admin_lib.php';
${snippet}
`);

    const result = spawnSync("php", ["run.php"], {
      cwd: fixture,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function hmac(value, secret) {
  const result = spawnSync("php", ["-r", `echo hash_hmac('sha256', ${JSON.stringify(value)}, ${JSON.stringify(secret)});`], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
