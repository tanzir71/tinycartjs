import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();

test("stripe webhook signature extracts paid checkout sessions", () => {
  assert.ok(existsSync(join(root, "payment.php")), "payment.php should exist");

  const event = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_paid",
        client_reference_id: "TORDER123",
        payment_status: "paid"
      }
    }
  };
  const raw = JSON.stringify(event);
  const timestamp = "1783162000";
  const secret = "whsec_test";
  const signature = `t=${timestamp},v1=${hmac(`${timestamp}.${raw}`, secret)}`;

  const paid = runPaymentSnippet(`
$raw = file_get_contents(__DIR__ . '/payload.json');
$paid = stripePaidOrder($raw, '${signature}', '${secret}');
echo json_encode($paid, JSON_UNESCAPED_SLASHES);
`, raw);

  assert.deepEqual(paid, {
    order_id: "TORDER123",
    provider: "stripe",
    session_id: "cs_test_paid"
  });
});

test("stripe webhook ignores unpaid checkout sessions", () => {
  const event = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_unpaid",
        client_reference_id: "TORDER123",
        payment_status: "unpaid"
      }
    }
  };
  const raw = JSON.stringify(event);
  const timestamp = "1783162001";
  const secret = "whsec_test";
  const signature = `t=${timestamp},v1=${hmac(`${timestamp}.${raw}`, secret)}`;

  const unpaid = runPaymentSnippet(`
$raw = file_get_contents(__DIR__ . '/payload.json');
$paid = stripePaidOrder($raw, '${signature}', '${secret}');
echo json_encode($paid, JSON_UNESCAPED_SLASHES);
`, raw);

  assert.equal(unpaid, null);
});

test("paypal return capture extracts completed orders", () => {
  const result = runPaymentSnippet(`
$requests = [];
$paid = paypalCapturePaidOrder('PAYPAL-ORDER-123', 'TORDER456', function ($method, $url, $headers, $body) use (&$requests) {
    $requests[] = compact('method', 'url', 'headers', 'body');
    if (str_contains($url, '/v1/oauth2/token')) {
        return ['status' => 200, 'body' => json_encode(['access_token' => 'access-token'])];
    }
    return ['status' => 201, 'body' => json_encode(['id' => 'PAYPAL-ORDER-123', 'status' => 'COMPLETED'])];
});
echo json_encode(['paid' => $paid, 'requests' => $requests], JSON_UNESCAPED_SLASHES);
`, "{}", [
    ["const PAYPAL_CLIENT_ID = '';", "const PAYPAL_CLIENT_ID = 'client-id';"],
    ["const PAYPAL_SECRET = '';", "const PAYPAL_SECRET = 'secret';"]
  ]);

  assert.deepEqual(result.paid, {
    order_id: "TORDER456",
    provider: "paypal",
    session_id: "PAYPAL-ORDER-123"
  });
  assert.match(result.requests[1].url, /\/v2\/checkout\/orders\/PAYPAL-ORDER-123\/capture$/);
});

test("markOrderPaid leaves provider identifiers and paid timestamp", () => {
  const result = runPaymentSnippet(`
class FakeStatement {
    public array $params = [];
    public function execute(array $params): void {
        $this->params = $params;
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
markOrderPaid($pdo, 'TORDER789', 'stripe', 'cs_paid_789');
echo json_encode(['sql' => $pdo->sql, 'params' => $pdo->statement->params], JSON_UNESCAPED_SLASHES);
`);

  assert.match(result.sql, /payment_status = 'paid'/);
  assert.equal(result.params[":id"], "TORDER789");
  assert.equal(result.params[":provider"], "stripe");
  assert.equal(result.params[":session_id"], "cs_paid_789");
  assert.match(result.params[":paid_at"], /^\d{4}-\d{2}-\d{2}T/);
});

function runPaymentSnippet(snippet, payload = "{}", replacements = []) {
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-payment-lib-"));
  try {
    let source = readFileSync(join(root, "payment.php"), "utf8").replace(/\npaymentMain\(\);\n/, "\n");
    for (const [from, to] of replacements) {
      source = source.replace(from, to);
    }
    writeFileSync(join(fixture, "payment_lib.php"), source);
    writeFileSync(join(fixture, "payload.json"), payload);
    writeFileSync(join(fixture, "run.php"), `<?php
require __DIR__ . '/payment_lib.php';
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
  const fixture = mkdtempSync(join(tmpdir(), "tinycart-hmac-"));
  try {
    writeFileSync(join(fixture, "run.php"), `<?php echo hash_hmac('sha256', ${JSON.stringify(value)}, ${JSON.stringify(secret)});`);
    const result = spawnSync("php", ["run.php"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
