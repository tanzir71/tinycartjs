import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const origin = "http://127.0.0.1:8000";
const hasPdoSqlite = spawnSync("php", ["-r", "echo extension_loaded('pdo_sqlite') ? '1' : '0';"], { encoding: "utf8" }).stdout === "1";

async function withServer(run) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-endpoints-"));
  for (const file of ["checkout.php", "collect.php", "coupon.php", "catalog.php", "download.php", "order-status.php"]) {
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
    mkdirSync(join(fixture, "files"), { recursive: true });
    writeFileSync(join(fixture, "files", "ebook.pdf"), "tiny ebook\n", { flag: "w" });
    await run(base, fixture);
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

async function getJson(url) {
  const response = await fetch(url);
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

const checkoutShippingConfig = `const SHIPPING = [
    'amount_cents' => 0,
    'free_above_cents' => null,
    'zones' => [],
];`;

const zoneShippingConfig = `const SHIPPING = [
    'amount_cents' => 0,
    'free_above_cents' => null,
    'zones' => [
        'local' => ['label' => 'Local pickup', 'amount_cents' => 200],
        'remote' => ['label' => 'Remote delivery', 'amount_cents' => 900],
    ],
];`;

const flatShippingConfig = `const SHIPPING = [
    'amount_cents' => 500,
    'free_above_cents' => null,
    'zones' => [],
];`;

const couponShippingConfig = `const COUPON_SHIPPING = [
    'amount_cents' => 0,
    'free_above_cents' => null,
    'zones' => [],
];`;

function digitalPayload() {
  const payload = checkoutPayload(null);
  payload.cart.items = [{
    id: "ebook-001",
    name: "TinyCart Ebook",
    priceCents: 1200,
    qty: 1,
    options: {}
  }];
  payload.cart.totals = { subtotalCents: 1200, discountCents: 0, totalCents: 1200 };
  return payload;
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

test("checkout and coupon validation respect admin coupon overrides", () => {
  const checkout = runCheckoutSnippet(`
$order = validateOrderPayload($payload, function (string $code): bool {
    return false;
});
echo json_encode([
    'discount_cents' => $order['discount_cents'],
    'coupon_code' => $order['coupon_code'],
    'total_cents' => $order['total_cents']
], JSON_UNESCAPED_SLASHES);
`, checkoutPayload({
      code: "SAVE10",
      type: "percent",
      value: 10,
      amount: 240
  }));

  assert.deepEqual(checkout, {
    discount_cents: 0,
    coupon_code: null,
    total_cents: 2400
  });

  assert.throws(
    () => runCouponSnippet(`
$coupon = couponValidate('SAVE10', 2400, function (string $code): bool {
    return false;
});
echo json_encode($coupon, JSON_UNESCAPED_SLASHES);
`),
    /Coupon not valid/
  );
});

test("checkout computes shipping server-side after coupons", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
echo json_encode([
    'subtotal_cents' => $order['subtotal_cents'],
    'discount_cents' => $order['discount_cents'],
    'shipping_cents' => $order['shipping_cents'],
    'total_cents' => $order['total_cents'],
], JSON_UNESCAPED_SLASHES);
`, checkoutPayload({
      code: "SAVE10",
      type: "percent",
      value: 10,
      amount: 240
  }), [[checkoutShippingConfig, flatShippingConfig]]);

  assert.deepEqual(result, {
    subtotal_cents: 2400,
    discount_cents: 240,
    shipping_cents: 500,
    total_cents: 2660
  });
});

test("shipping zone tampering cannot lower the configured server fee", () => {
  const payload = {
    ...checkoutPayload(null),
    shipping: { zone: "remote", amount_cents: 0 }
  };
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
echo json_encode([
    'shipping_cents' => $order['shipping_cents'],
    'shipping_zone' => $order['shipping_zone'],
    'shipping_label' => $order['shipping_label'],
    'total_cents' => $order['total_cents'],
], JSON_UNESCAPED_SLASHES);
`, payload, [[checkoutShippingConfig, zoneShippingConfig]]);

  assert.deepEqual(result, {
    shipping_cents: 900,
    shipping_zone: "remote",
    shipping_label: "Remote delivery",
    total_cents: 3300
  });
});

test("coupon preview includes server shipping and total cents", () => {
  const result = runCouponSnippet(`
$payload = [
    'code' => 'SAVE10',
    'cart' => ['totals' => ['subtotalCents' => 2400]],
    'shipping' => ['zone' => 'remote', 'amount_cents' => 0],
];
$subtotalCents = couponSubtotalCents($payload['cart']);
$coupon = couponValidate('SAVE10', $subtotalCents, null);
$shipping = couponResolveShipping($payload['shipping'], $subtotalCents, $coupon['discount_cents']);
echo json_encode([
    'discount_cents' => $coupon['discount_cents'],
    'shipping_cents' => $shipping['amount_cents'],
    'total_cents' => max(0, $subtotalCents - $coupon['discount_cents']) + $shipping['amount_cents'],
], JSON_UNESCAPED_SLASHES);
`, [[couponShippingConfig, `const COUPON_SHIPPING = [
    'amount_cents' => 0,
    'free_above_cents' => null,
    'zones' => [
        'local' => ['label' => 'Local pickup', 'amount_cents' => 200],
        'remote' => ['label' => 'Remote delivery', 'amount_cents' => 900],
    ],
];`]]);

  assert.deepEqual(result, {
    discount_cents: 240,
    shipping_cents: 900,
    total_cents: 3060
  });
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

test("admin dashboard actions require CSRF and update order operations safely", () => {
  const result = runAdminSnippet(`
class FakeStatement {
    public array $params = [];
    public function execute(array $params = []): void { $this->params = $params; }
    public function fetchAll(): array { return []; }
    public function rowCount(): int { return 1; }
}

class FakePdo {
    public array $calls = [];
    public function prepare(string $sql): FakeStatement {
        $statement = new FakeStatement();
        $this->calls[] = ['sql' => $sql, 'statement' => $statement];
        return $statement;
    }
}
$_SESSION = ['tc_admin_csrf' => 'known-token'];
$_POST = ['_csrf' => 'wrong-token'];
$csrfStatus = null;
try {
    requireAdminCsrf();
} catch (AdminError $error) {
    $csrfStatus = $error->statusCode;
}
$_POST = ['_csrf' => 'known-token'];
requireAdminCsrf();

$invalidPaymentStatus = null;
try {
    updateAdminOrderStatus(new FakePdo(), 'TCOD123', 'stolen', 'packed', '');
} catch (AdminError $error) {
    $invalidPaymentStatus = $error->statusCode;
}

$pdo = new FakePdo();
updateAdminOrderStatus($pdo, 'TCOD123', 'paid', 'fulfilled', '=call me');
markAdminCodCollected($pdo, 'TCOD123');
updateAdminInventoryStock($pdo, 'tee-001', 17);
setAdminCouponOverride($pdo, 'SAVE10', false);
retryAdminWebhook($pdo, 9);

echo json_encode([
    'csrf_status' => $csrfStatus,
    'invalid_payment_status' => $invalidPaymentStatus,
    'call_count' => count($pdo->calls),
    'first_sql' => $pdo->calls[0]['sql'],
    'first_params' => $pdo->calls[0]['statement']->params,
    'cod_sql' => $pdo->calls[1]['sql'],
    'cod_params' => $pdo->calls[1]['statement']->params,
    'inventory_sql' => $pdo->calls[2]['sql'],
    'coupon_sql' => $pdo->calls[3]['sql'],
    'retry_sql' => $pdo->calls[4]['sql']
], JSON_UNESCAPED_SLASHES);
`);

  assert.equal(result.csrf_status, 403);
  assert.equal(result.invalid_payment_status, 400);
  assert.equal(result.call_count, 5);
  assert.match(result.first_sql, /^UPDATE orders/i);
  assert.equal(result.first_params[":payment_status"], "paid");
  assert.equal(result.first_params[":fulfillment_status"], "fulfilled");
  assert.equal(result.first_params[":admin_note"], "=call me");
  assert.match(result.cod_sql, /payment_status = 'paid'/);
  assert.equal(result.cod_params[":id"], "TCOD123");
  assert.match(result.inventory_sql, /UPDATE inventory/i);
  assert.match(result.coupon_sql, /coupon_overrides/i);
  assert.match(result.retry_sql, /webhook_deliveries/i);
});

test("order status lookup requires both order id and phone", () => {
  const result = runOrderStatusSnippet(`
class FakeStatement {
    public array $params = [];
    public function __construct(private string $kind, private FakePdo $pdo) {}
    public function execute(array $params = []): void {
        $this->params = $params;
        $this->pdo->calls[] = ['kind' => $this->kind, 'params' => $params];
    }
    public function fetch(): mixed {
        if ($this->kind !== 'order') {
            return false;
        }
        if (($this->params[':id'] ?? '') !== 'T123' || ($this->params[':phone'] ?? '') !== '+15551234567') {
            return false;
        }
        return [
            'id' => 'T123',
            'created_at' => '2026-07-04T00:00:00+00:00',
            'currency' => 'USD',
            'customer_address' => '1 Byte Lane, Dhaka',
            'subtotal_cents' => 2400,
            'discount_cents' => 240,
            'shipping_cents' => 500,
            'total_cents' => 2660,
            'coupon_code' => 'SAVE10',
            'payment_method' => 'cod',
            'payment_status' => 'cod_due',
            'fulfillment_status' => 'new',
        ];
    }
    public function fetchAll(): array {
        return [[
            'product_id' => 'tee-001',
            'product_name' => 'TinyCart Tee',
            'price_cents' => 2400,
            'qty' => 1,
            'line_total_cents' => 2400,
        ]];
    }
}
class FakePdo {
    public array $calls = [];
    public string $orderSql = '';
    public function prepare(string $sql): FakeStatement {
        if (str_contains($sql, 'FROM orders')) {
            $this->orderSql = $sql;
            return new FakeStatement('order', $this);
        }
        return new FakeStatement('items', $this);
    }
}
$pdo = new FakePdo();
$hit = lookupOrderStatus($pdo, 'T123', '+15551234567');
$wrongPhone = lookupOrderStatus($pdo, 'T123', '+0000000000');
$wrongId = lookupOrderStatus($pdo, 'T404', '+15551234567');
echo json_encode([
    'hit_total' => $hit['total_cents'] ?? null,
    'hit_items' => count($hit['items'] ?? []),
    'wrong_phone' => $wrongPhone,
    'wrong_id' => $wrongId,
    'order_sql' => $pdo->orderSql,
    'calls' => $pdo->calls,
], JSON_UNESCAPED_SLASHES);
`);

  assert.equal(result.hit_total, 2660);
  assert.equal(result.hit_items, 1);
  assert.equal(result.wrong_phone, null);
  assert.equal(result.wrong_id, null);
  assert.match(result.order_sql, /WHERE id = :id\s+AND customer_phone = :phone/i);
  assert.equal(result.calls[2].params[":id"], "T123");
  assert.equal(result.calls[2].params[":phone"], "+0000000000");
  assert.equal(result.calls[3].params[":id"], "T404");
});

test("order status misses use the same response shape and similar timing", () => {
  const result = runOrderStatusSnippet(`
class FakeStatement {
    public array $params = [];
    public function __construct(private FakePdo $pdo) {}
    public function execute(array $params = []): void {
        $this->params = $params;
        $this->pdo->calls[] = $params;
    }
    public function fetch(): mixed {
        usleep(2000);
        return false;
    }
    public function fetchAll(): array { return []; }
}
class FakePdo {
    public array $calls = [];
    public function prepare(string $sql): FakeStatement {
        return new FakeStatement($this);
    }
}
function missLookup(FakePdo $pdo, string $orderId, string $phone): array {
    $start = hrtime(true);
    $order = lookupOrderStatus($pdo, $orderId, $phone);
    $html = renderOrderStatusPage($order, true);
    return [
        'status' => 200,
        'found' => $order !== null,
        'elapsed_ms' => (hrtime(true) - $start) / 1000000,
        'body_hash' => hash('sha256', $html),
    ];
}
$pdo = new FakePdo();
$wrongPhone = missLookup($pdo, 'T123', '+0000000000');
$wrongId = missLookup($pdo, 'T404', '+15551234567');
echo json_encode([
    'wrong_phone' => $wrongPhone,
    'wrong_id' => $wrongId,
    'elapsed_delta_ms' => abs($wrongPhone['elapsed_ms'] - $wrongId['elapsed_ms']),
    'calls' => $pdo->calls,
], JSON_UNESCAPED_SLASHES);
`);

  assert.equal(result.wrong_phone.status, 200);
  assert.equal(result.wrong_id.status, 200);
  assert.equal(result.wrong_phone.found, false);
  assert.equal(result.wrong_id.found, false);
  assert.equal(result.wrong_phone.body_hash, result.wrong_id.body_hash);
  assert.ok(result.elapsed_delta_ms <= 20, `miss timing delta should stay small, got ${result.elapsed_delta_ms}ms`);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0][":id"], "T123");
  assert.equal(result.calls[1][":id"], "T404");
});

test("order status page escapes output and shows only partial address", () => {
  const result = runOrderStatusSnippet(`
$order = [
    'id' => 'T<script>alert(1)</script>',
    'created_at' => '2026-07-04T00:00:00+00:00',
    'currency' => 'USD',
    'customer_address' => "1 <Main> St\\nApartment 9, Secret Floor, Dhaka",
    'subtotal_cents' => 2400,
    'discount_cents' => 240,
    'shipping_cents' => 500,
    'total_cents' => 2660,
    'coupon_code' => 'SAVE10',
    'payment_method' => 'cod',
    'payment_status' => 'cod_due',
    'fulfillment_status' => 'shipped',
    'items' => [[
        'product_id' => 'tee-001',
        'product_name' => '<img src=x onerror=alert(1)>',
        'price_cents' => 2400,
        'qty' => 1,
        'line_total_cents' => 2400,
    ]],
];
$html = renderOrderStatusPage($order, true);
$miss = renderOrderStatusPage(null, true);
echo json_encode(['html' => $html, 'miss' => $miss], JSON_UNESCAPED_SLASHES);
`);

  assert.match(result.html, /Order status/);
  assert.match(result.html, /Received/);
  assert.match(result.html, /Cash due/);
  assert.match(result.html, /Shipped/);
  assert.match(result.html, /26\.60 USD/);
  assert.match(result.html, /1 &lt;Main&gt; St/);
  assert.doesNotMatch(result.html, /Apartment 9/);
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(result.html, /<img src=x/);
  assert.doesNotMatch(result.html, /<script>alert/);
  assert.match(result.miss, /No matching order found/);
  assert.doesNotMatch(result.miss, /T&lt;script/);
});

test("order status rejects foreign origins and rate-limits lookups", () => {
  const result = runOrderStatusSnippet(`
$originStatus = null;
try {
    $_SERVER['HTTP_ORIGIN'] = 'https://evil.example';
    statusHandleOrigin();
} catch (StatusError $error) {
    $originStatus = $error->statusCode;
}
unset($_SERVER['HTTP_ORIGIN']);
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$rateStatus = null;
try {
    statusRateLimit(statusClientIp());
    statusRateLimit(statusClientIp());
    statusRateLimit(statusClientIp());
} catch (StatusError $error) {
    $rateStatus = $error->statusCode;
}
echo json_encode(['origin_status' => $originStatus, 'rate_status' => $rateStatus], JSON_UNESCAPED_SLASHES);
`, [["const ORDER_STATUS_RATE_LIMIT_MAX_REQUESTS = 20;", "const ORDER_STATUS_RATE_LIMIT_MAX_REQUESTS = 2;"]]);

  assert.equal(result.origin_status, 403);
  assert.equal(result.rate_status, 429);
});

test("admin CSV export escapes formula-like cells and includes filtered order fields", () => {
  const result = runAdminSnippet(`
$csv = renderAdminCsv([
    [
        'id' => '=2+3',
        'created_at' => '2026-07-04T00:00:00+00:00',
        'customer_name' => '+Ada',
        'customer_email' => 'ada@example.com',
        'customer_phone' => '+15551234567',
        'payment_method' => 'cod',
        'payment_status' => 'cod_due',
        'fulfillment_status' => 'new',
        'total_cents' => 2400,
        'currency' => 'USD',
        'coupon_code' => 'SAVE10',
    ]
]);
echo json_encode(['csv' => $csv], JSON_UNESCAPED_SLASHES);
`);

  assert.match(result.csv, /Order ID,Created,Customer,Email,Phone,Payment Method,Payment Status,Fulfillment Status,Total,Coupon/);
  assert.match(result.csv, /'=2\+3/);
  assert.match(result.csv, /'\+Ada/);
  assert.match(result.csv, /cod_due/);
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

test("legacy checkout defaults to manual payment when no provider is configured", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$handoff = createPaymentHandoff($order, 'TMANUAL123', function () {
    throw new RuntimeException('provider should not be called');
});
echo json_encode([
    'payment_method' => $order['payment_method'],
    'payment_status' => $order['payment_status'],
    'payment_provider' => $order['payment_provider'],
    'handoff' => $handoff
], JSON_UNESCAPED_SLASHES);
`, checkoutPayload(null));

  assert.deepEqual(result, {
    payment_method: "manual",
    payment_status: "pending",
    payment_provider: null,
    handoff: null
  });
});

test("cash on delivery checkout stores cod due status and skips provider handoff", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$called = false;
$handoff = createPaymentHandoff($order, 'TCOD123', function () use (&$called) {
    $called = true;
    return ['status' => 200, 'body' => '{}'];
});
echo json_encode([
    'payment_method' => $order['payment_method'],
    'payment_status' => $order['payment_status'],
    'payment_provider' => $order['payment_provider'],
    'handoff' => $handoff,
    'called' => $called
], JSON_UNESCAPED_SLASHES);
`, { ...checkoutPayload(null), paymentMethod: "cod" }, [
    ["const ENABLED_PAYMENT_METHODS = [];", "const ENABLED_PAYMENT_METHODS = ['online', 'cod'];"],
    ["const PAYMENT_PROVIDER = '';", "const PAYMENT_PROVIDER = 'stripe';"]
  ]);

  assert.deepEqual(result, {
    payment_method: "cod",
    payment_status: "cod_due",
    payment_provider: "cod",
    handoff: null,
    called: false
  });
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

test("checkout creates signed digital download links for email and success responses", () => {
  const result = runCheckoutSnippet(`
$order = validateOrderPayload($payload);
$links = digitalDownloadLinks($order, 'TDOWNLOAD1');
$order['downloads'] = $links;
$summary = orderSummary('TDOWNLOAD1', $order);
echo json_encode(['links' => $links, 'email' => plainOrderEmail($summary)], JSON_UNESCAPED_SLASHES);
`, digitalPayload());

  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].item, "ebook-001");
  assert.match(result.links[0].url, /download\.php\?order=TDOWNLOAD1&item=ebook-001&exp=\d+&sig=[a-f0-9]{64}/);
  assert.match(result.email, /Download TinyCart Ebook: download\.php/);
});

test("download endpoint rejects forged and expired signatures before storage lookup", async () => {
  await withServer(async (base) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const forged = new URL(`${base}/download.php`);
    forged.search = new URLSearchParams({
      order: "TDOWNLOAD1",
      item: "ebook-001",
      exp: String(exp),
      sig: hmac(`TFORGED|ebook-001|${exp}`, "replace-with-32-plus-random-bytes")
    }).toString();
    const [forgedResponse, forgedJson] = await getJson(forged);
    assert.equal(forgedResponse.status, 403);
    assert.deepEqual(forgedJson, { ok: false, error: "Invalid download link" });

    const expired = new URL(`${base}/download.php`);
    expired.search = new URLSearchParams({
      order: "TDOWNLOAD1",
      item: "ebook-001",
      exp: "1",
      sig: hmac("TDOWNLOAD1|ebook-001|1", "replace-with-32-plus-random-bytes")
    }).toString();
    const [expiredResponse, expiredJson] = await getJson(expired);
    assert.equal(expiredResponse.status, 403);
    assert.deepEqual(expiredJson, { ok: false, error: "Download link expired" });
  });
});

test("digital download links are signed, gated, and capped", { skip: hasPdoSqlite ? false : "pdo_sqlite extension is unavailable in local PHP" }, async () => {
  await withServer(async (base, fixture) => {
    const [, order] = await postJson(base, "checkout.php", digitalPayload());
    assert.equal(order.ok, true);
    assert.equal(order.downloads.length, 1);
    const link = new URL(order.downloads[0].url, base);

    const tampered = new URL(link);
    tampered.searchParams.set("item", "tee-001");
    const [tamperedResponse, tamperedJson] = await getJson(tampered);
    assert.equal(tamperedResponse.status, 403);
    assert.equal(tamperedJson.ok, false);
    assert.equal(tamperedJson.error, "Invalid download link");

    const expired = new URL(link);
    expired.searchParams.set("exp", "1");
    expired.searchParams.set("sig", hmac(`${order.order_id}|ebook-001|1`, "replace-with-32-plus-random-bytes"));
    const [expiredResponse, expiredJson] = await getJson(expired);
    assert.equal(expiredResponse.status, 403);
    assert.equal(expiredJson.ok, false);
    assert.equal(expiredJson.error, "Download link expired");

    setOrderPayment(fixture, order.order_id, "paid", "manual");
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(link);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "tiny ebook\n");
    }
    const [limitedResponse, limitedJson] = await getJson(link);
    assert.equal(limitedResponse.status, 403);
    assert.equal(limitedJson.ok, false);
    assert.equal(limitedJson.error, "Download limit reached");
  });
});

test("unpaid online orders cannot download digital files", { skip: hasPdoSqlite ? false : "pdo_sqlite extension is unavailable in local PHP" }, async () => {
  await withServer(async (base, fixture) => {
    const [, order] = await postJson(base, "checkout.php", digitalPayload());
    const link = new URL(order.downloads[0].url, base);
    setOrderPayment(fixture, order.order_id, "pending", "online");

    const [response, body] = await getJson(link);
    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
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
    let source = readFileSync(join(root, "checkout.php"), "utf8").replace(/\r?\nmain\(\);\r?\n/, "\n");
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

function runCouponSnippet(snippet, replacements = []) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-coupon-lib-"));
  try {
    let source = readFileSync(join(root, "coupon.php"), "utf8").replace(/\r?\ncouponMain\(\);\r?\n/, "\n");
    for (const [from, to] of replacements) {
      source = source.replace(from, to);
    }
    writeFileSync(join(fixture, "coupon_lib.php"), source);
    writeFileSync(join(fixture, "run.php"), `<?php
require __DIR__ . '/coupon_lib.php';
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
    let source = readFileSync(join(root, "admin.php"), "utf8").replace(/\r?\nmain\(\);\r?\n/, "\n");
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

function runOrderStatusSnippet(snippet, replacements = []) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-order-status-lib-"));
  try {
    let source = readFileSync(join(root, "order-status.php"), "utf8").replace(/\r?\nstatusMain\(\);\r?\n/, "\n");
    for (const [from, to] of replacements) {
      source = source.replace(from, to);
    }
    writeFileSync(join(fixture, "order_status_lib.php"), source);
    writeFileSync(join(fixture, "run.php"), `<?php
require __DIR__ . '/order_status_lib.php';
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

function setOrderPayment(fixture, orderId, status, method) {
  const db = join(fixture, "data", "orders.sqlite").replace(/\\/g, "/");
  const code = `$pdo=new PDO("sqlite:${db}");$stmt=$pdo->prepare("UPDATE orders SET payment_status=?, payment_method=? WHERE id=?");$stmt->execute([${JSON.stringify(status)},${JSON.stringify(method)},${JSON.stringify(orderId)}]);`;
  const result = spawnSync("php", ["-r", code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
