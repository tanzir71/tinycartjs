<?php
declare(strict_types=1);

/**
 * TinyCart server-rendered ops dashboard.
 *
 * Configure either ADMIN_API_KEYS or ADMIN_PASSWORD_HASH before deploying.
 * ADMIN_PASSWORD_HASH should be created with password_hash('your-password', PASSWORD_DEFAULT).
 */

const ADMIN_ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const ADMIN_API_KEYS = [];
const ADMIN_PASSWORD_HASH = '';
const ADMIN_DB_PATH = __DIR__ . '/data/orders.sqlite';
const ADMIN_PAGE_SIZE = 25;

const ADMIN_PAYMENT_METHODS = ['online', 'cod', 'manual'];
const ADMIN_PAYMENT_STATUSES = ['pending', 'paid', 'cod_due', 'cancelled', 'refunded'];
const ADMIN_FULFILLMENT_STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'fulfilled', 'cancelled'];

const ADMIN_PRODUCT_CATALOG = [
    'tee-001' => ['name' => 'TinyCart Tee', 'stock' => 100],
    'mug-001' => ['name' => 'Checkout Mug', 'stock' => 80],
    'sticker-001' => ['name' => 'Script Tag Sticker Pack', 'stock' => 250],
];

const ADMIN_COUPONS = [
    'SAVE10' => ['label' => '10% off', 'active' => true],
    'EXPIRED' => ['label' => 'Expired sample', 'active' => true],
];

main();

function main(): void
{
    try {
        startAdminSession();
        handleAdminOrigin();

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        requireAdminAuth();
        $pdo = adminDb();

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            handleAdminPost($pdo);
        }
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
            throw new AdminError('Method not allowed', 405);
        }

        $filters = adminFilters();
        if (($_GET['export'] ?? '') === 'csv') {
            $export = fetchAdminOrders($pdo, 1, 5000, $filters);
            adminCsvResponse(renderAdminCsv($export['orders']));
        }

        $listing = fetchAdminOrders($pdo, adminPage(), ADMIN_PAGE_SIZE, $filters);
        $orderId = adminCleanString($_GET['order'] ?? '', 120);
        $detail = $orderId !== '' ? fetchAdminOrder($pdo, $orderId) : null;
        $items = $detail ? fetchAdminOrderItems($pdo, $orderId) : [];

        http_response_code(200);
        header('Content-Type: text/html; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        echo renderAdminPage($listing, [
            'filters' => $filters,
            'csrf' => adminCsrfToken(),
            'flash' => adminFlash(),
            'detail' => $detail,
            'items' => $items,
            'inventory' => fetchAdminInventory($pdo),
            'coupons' => fetchAdminCoupons($pdo),
            'webhooks' => fetchAdminWebhookDeliveries($pdo),
        ]);
    } catch (AdminError $error) {
        adminTextResponse($error->getMessage(), $error->statusCode);
    } catch (Throwable) {
        adminTextResponse('Unable to load orders.', 500);
    }
}

function startAdminSession(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
        session_start();
    }
}

function handleAdminOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    if (!in_array($origin, ADMIN_ALLOWED_ORIGINS, true)) {
        throw new AdminError('Origin not allowed', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Authorization');
    header('Access-Control-Max-Age: 600');
}

function requireAdminAuth(): void
{
    $hasKeyConfig = count(ADMIN_API_KEYS) > 0;
    $hasPasswordConfig = ADMIN_PASSWORD_HASH !== '';
    if (!$hasKeyConfig && !$hasPasswordConfig) {
        throw new AdminError('Admin access is not configured.', 403);
    }

    $providedKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if ($providedKey !== '') {
        foreach (ADMIN_API_KEYS as $allowed) {
            if (hash_equals($allowed, $providedKey)) {
                return;
            }
        }
    }

    $password = $_SERVER['PHP_AUTH_PW'] ?? '';
    if ($hasPasswordConfig && $password !== '' && password_verify($password, ADMIN_PASSWORD_HASH)) {
        return;
    }

    header('WWW-Authenticate: Basic realm="TinyCart Admin"');
    throw new AdminError('Unauthorized', 401);
}

function adminCsrfToken(): string
{
    startAdminSession();
    if (!isset($_SESSION['tc_admin_csrf']) || !is_string($_SESSION['tc_admin_csrf'])) {
        $_SESSION['tc_admin_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['tc_admin_csrf'];
}

function requireAdminCsrf(): void
{
    $expected = $_SESSION['tc_admin_csrf'] ?? '';
    $provided = $_POST['_csrf'] ?? '';
    if (!is_string($expected) || !is_string($provided) || $expected === '' || !hash_equals($expected, $provided)) {
        throw new AdminError('Invalid CSRF token', 403);
    }
}

function handleAdminPost($pdo): void
{
    requireAdminCsrf();
    $action = adminCleanString($_POST['action'] ?? '', 40);

    if ($action === 'update_order') {
        updateAdminOrderStatus(
            $pdo,
            adminCleanString($_POST['order_id'] ?? '', 120),
            adminCleanString($_POST['payment_status'] ?? '', 40),
            adminCleanString($_POST['fulfillment_status'] ?? '', 40),
            adminCleanString($_POST['admin_note'] ?? '', 1000)
        );
        adminFlash('Order updated.');
    } elseif ($action === 'collect_cod') {
        markAdminCodCollected($pdo, adminCleanString($_POST['order_id'] ?? '', 120));
        adminFlash('Cash collected.');
    } elseif ($action === 'update_inventory') {
        $stock = filter_var($_POST['stock'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 0, 'max_range' => 1000000]
        ]);
        if ($stock === false) {
            throw new AdminError('Invalid stock value', 400);
        }
        updateAdminInventoryStock($pdo, adminCleanString($_POST['product_id'] ?? '', 120), (int)$stock);
        adminFlash('Inventory updated.');
    } elseif ($action === 'set_coupon') {
        setAdminCouponOverride(
            $pdo,
            strtoupper(adminCleanString($_POST['code'] ?? '', 40)),
            (string)($_POST['active'] ?? '0') === '1'
        );
        adminFlash('Coupon override updated.');
    } elseif ($action === 'retry_webhook') {
        $deliveryId = filter_var($_POST['delivery_id'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1]
        ]);
        if ($deliveryId === false) {
            throw new AdminError('Invalid delivery id', 400);
        }
        retryAdminWebhook($pdo, (int)$deliveryId);
        adminFlash('Webhook retry queued.');
    } else {
        throw new AdminError('Unknown admin action', 400);
    }

    adminRedirect();
}

function adminDb(): PDO
{
    $pdo = new PDO('sqlite:' . ADMIN_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    adminRun($pdo, 'PRAGMA foreign_keys = ON');
    ensureAdminSchema($pdo);
    return $pdo;
}

function ensureAdminSchema($pdo): void
{
    adminRun(
        $pdo,
        'CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            cart_key TEXT NOT NULL DEFAULT "",
            currency TEXT NOT NULL DEFAULT "USD",
            customer_name TEXT NOT NULL DEFAULT "",
            customer_phone TEXT NOT NULL DEFAULT "",
            customer_email TEXT,
            customer_address TEXT NOT NULL DEFAULT "",
            subtotal_cents INTEGER NOT NULL DEFAULT 0,
            discount_cents INTEGER NOT NULL DEFAULT 0,
            total_cents INTEGER NOT NULL DEFAULT 0,
            coupon_code TEXT,
            payment_method TEXT NOT NULL DEFAULT "manual",
            payment_status TEXT NOT NULL DEFAULT "pending",
            payment_provider TEXT,
            payment_session_id TEXT,
            paid_at TEXT,
            fulfillment_status TEXT NOT NULL DEFAULT "new",
            admin_note TEXT NOT NULL DEFAULT "",
            page TEXT,
            ip_hash TEXT NOT NULL DEFAULT "",
            created_at TEXT NOT NULL,
            updated_at TEXT
        )'
    );
    ensureAdminColumn($pdo, 'orders', 'discount_cents', 'INTEGER NOT NULL DEFAULT 0');
    ensureAdminColumn($pdo, 'orders', 'total_cents', 'INTEGER NOT NULL DEFAULT 0');
    ensureAdminColumn($pdo, 'orders', 'coupon_code', 'TEXT');
    ensureAdminColumn($pdo, 'orders', 'payment_method', 'TEXT NOT NULL DEFAULT "manual"');
    ensureAdminColumn($pdo, 'orders', 'payment_status', 'TEXT NOT NULL DEFAULT "pending"');
    ensureAdminColumn($pdo, 'orders', 'payment_provider', 'TEXT');
    ensureAdminColumn($pdo, 'orders', 'payment_session_id', 'TEXT');
    ensureAdminColumn($pdo, 'orders', 'paid_at', 'TEXT');
    ensureAdminColumn($pdo, 'orders', 'fulfillment_status', 'TEXT NOT NULL DEFAULT "new"');
    ensureAdminColumn($pdo, 'orders', 'admin_note', 'TEXT NOT NULL DEFAULT ""');
    ensureAdminColumn($pdo, 'orders', 'updated_at', 'TEXT');

    adminRun(
        $pdo,
        'CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            price_cents INTEGER NOT NULL,
            qty INTEGER NOT NULL,
            line_total_cents INTEGER NOT NULL,
            options_json TEXT NOT NULL,
            signature TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
        )'
    );
    adminRun(
        $pdo,
        'CREATE TABLE IF NOT EXISTS inventory (
            product_id TEXT PRIMARY KEY,
            stock INTEGER NOT NULL
        )'
    );
    adminRun(
        $pdo,
        'CREATE TABLE IF NOT EXISTS coupon_overrides (
            code TEXT PRIMARY KEY,
            active INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );
    adminRun(
        $pdo,
        'CREATE TABLE IF NOT EXISTS webhook_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            url TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            signature TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT NOT NULL,
            last_error TEXT,
            created_at TEXT NOT NULL
        )'
    );
    seedAdminInventory($pdo);
}

function ensureAdminColumn($pdo, string $table, string $column, string $definition): void
{
    $columns = $pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($columns as $existing) {
        if (($existing['name'] ?? '') === $column) {
            return;
        }
    }
    adminRun($pdo, 'ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
}

function seedAdminInventory($pdo): void
{
    $statement = $pdo->prepare(
        'INSERT OR IGNORE INTO inventory (product_id, stock)
         VALUES (:product_id, :stock)'
    );
    foreach (ADMIN_PRODUCT_CATALOG as $id => $product) {
        $statement->execute([
            ':product_id' => $id,
            ':stock' => max(0, (int)($product['stock'] ?? 0)),
        ]);
    }
}

function adminRun($pdo, string $sql, array $params = []): void
{
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
}

function adminPage(): int
{
    $page = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1, 'max_range' => 100000]
    ]);
    return $page === false ? 1 : (int)$page;
}

function adminFilters(): array
{
    $paymentMethod = adminCleanString($_GET['payment_method'] ?? '', 20);
    $paymentStatus = adminCleanString($_GET['payment_status'] ?? '', 40);
    $fulfillmentStatus = adminCleanString($_GET['fulfillment_status'] ?? '', 40);

    return [
        'q' => adminCleanString($_GET['q'] ?? '', 120),
        'payment_method' => in_array($paymentMethod, ADMIN_PAYMENT_METHODS, true) ? $paymentMethod : '',
        'payment_status' => in_array($paymentStatus, ADMIN_PAYMENT_STATUSES, true) ? $paymentStatus : '',
        'fulfillment_status' => in_array($fulfillmentStatus, ADMIN_FULFILLMENT_STATUSES, true) ? $fulfillmentStatus : '',
    ];
}

function fetchAdminOrders($pdo, int $page, int $pageSize = ADMIN_PAGE_SIZE, array $filters = []): array
{
    $page = max(1, $page);
    $pageSize = max(1, min(5000, $pageSize));
    $limit = $pageSize + 1;
    $offset = ($page - 1) * $pageSize;
    [$where, $params] = adminWhere($filters);

    $statement = $pdo->prepare(
        'SELECT id, created_at, currency, subtotal_cents, discount_cents, total_cents,
                coupon_code, payment_method, payment_status, payment_provider, fulfillment_status,
                admin_note, customer_name, customer_email, customer_phone
         FROM orders
         ' . $where . '
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT :limit OFFSET :offset'
    );
    $params[':limit'] = $limit;
    $params[':offset'] = $offset;
    $statement->execute($params);

    $rows = $statement->fetchAll();
    $hasNext = count($rows) > $pageSize;
    if ($hasNext) {
        $rows = array_slice($rows, 0, $pageSize);
    }

    return [
        'orders' => array_map('normalizeAdminOrder', $rows),
        'page' => $page,
        'page_size' => $pageSize,
        'has_prev' => $page > 1,
        'has_next' => $hasNext,
        'filters' => $filters,
    ];
}

function adminWhere(array $filters): array
{
    $clauses = [];
    $params = [];
    foreach (['payment_method', 'payment_status', 'fulfillment_status'] as $field) {
        $value = adminCleanString($filters[$field] ?? '', 40);
        if ($value !== '') {
            $clauses[] = $field . ' = :' . $field;
            $params[':' . $field] = $value;
        }
    }
    $query = adminCleanString($filters['q'] ?? '', 120);
    if ($query !== '') {
        $clauses[] = '(id LIKE :q OR customer_name LIKE :q OR customer_email LIKE :q OR customer_phone LIKE :q OR coupon_code LIKE :q OR admin_note LIKE :q)';
        $params[':q'] = '%' . $query . '%';
    }
    return [count($clauses) > 0 ? 'WHERE ' . implode(' AND ', $clauses) : '', $params];
}

function normalizeAdminOrder(array $row): array
{
    return [
        'id' => (string)($row['id'] ?? ''),
        'created_at' => (string)($row['created_at'] ?? ''),
        'updated_at' => (string)($row['updated_at'] ?? ''),
        'currency' => strtoupper((string)($row['currency'] ?? 'USD')),
        'subtotal_cents' => (int)($row['subtotal_cents'] ?? 0),
        'discount_cents' => (int)($row['discount_cents'] ?? 0),
        'total_cents' => (int)($row['total_cents'] ?? 0),
        'coupon_code' => (string)($row['coupon_code'] ?? ''),
        'payment_method' => (string)($row['payment_method'] ?? 'manual'),
        'payment_status' => (string)($row['payment_status'] ?? 'pending'),
        'payment_provider' => (string)($row['payment_provider'] ?? ''),
        'fulfillment_status' => (string)($row['fulfillment_status'] ?? 'new'),
        'admin_note' => (string)($row['admin_note'] ?? ''),
        'customer_name' => (string)($row['customer_name'] ?? ''),
        'customer_email' => (string)($row['customer_email'] ?? ''),
        'customer_phone' => (string)($row['customer_phone'] ?? ''),
    ];
}

function fetchAdminOrder($pdo, string $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT id, created_at, updated_at, cart_key, currency, customer_name, customer_phone,
                customer_email, customer_address, subtotal_cents, discount_cents, total_cents,
                coupon_code, payment_method, payment_status, payment_provider, payment_session_id,
                paid_at, fulfillment_status, admin_note, page
         FROM orders
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $row = $statement->fetch();
    return is_array($row) ? normalizeAdminOrderDetail($row) : null;
}

function normalizeAdminOrderDetail(array $row): array
{
    return normalizeAdminOrder($row) + [
        'cart_key' => (string)($row['cart_key'] ?? ''),
        'customer_address' => (string)($row['customer_address'] ?? ''),
        'payment_session_id' => (string)($row['payment_session_id'] ?? ''),
        'paid_at' => (string)($row['paid_at'] ?? ''),
        'page' => (string)($row['page'] ?? ''),
    ];
}

function fetchAdminOrderItems($pdo, string $orderId): array
{
    $statement = $pdo->prepare(
        'SELECT product_id, product_name, price_cents, qty, line_total_cents, options_json
         FROM order_items
         WHERE order_id = :order_id
         ORDER BY id ASC'
    );
    $statement->execute([':order_id' => $orderId]);
    return array_map(static fn(array $row): array => [
        'product_id' => (string)($row['product_id'] ?? ''),
        'product_name' => (string)($row['product_name'] ?? ''),
        'price_cents' => (int)($row['price_cents'] ?? 0),
        'qty' => (int)($row['qty'] ?? 0),
        'line_total_cents' => (int)($row['line_total_cents'] ?? 0),
        'options_json' => (string)($row['options_json'] ?? ''),
    ], $statement->fetchAll());
}

function fetchAdminInventory($pdo): array
{
    $statement = $pdo->prepare(
        'SELECT product_id, stock
         FROM inventory
         ORDER BY product_id ASC'
    );
    $statement->execute();
    return array_map(static fn(array $row): array => [
        'product_id' => (string)($row['product_id'] ?? ''),
        'name' => (string)(ADMIN_PRODUCT_CATALOG[$row['product_id'] ?? '']['name'] ?? $row['product_id'] ?? ''),
        'stock' => (int)($row['stock'] ?? 0),
    ], $statement->fetchAll());
}

function fetchAdminCoupons($pdo): array
{
    $statement = $pdo->prepare('SELECT code, active FROM coupon_overrides');
    $statement->execute();
    $overrides = [];
    foreach ($statement->fetchAll() as $row) {
        $overrides[(string)($row['code'] ?? '')] = (int)($row['active'] ?? 1) === 1;
    }

    $coupons = [];
    foreach (ADMIN_COUPONS as $code => $coupon) {
        $defaultActive = (bool)($coupon['active'] ?? true);
        $coupons[] = [
            'code' => $code,
            'label' => (string)($coupon['label'] ?? ''),
            'active' => $overrides[$code] ?? $defaultActive,
            'overridden' => array_key_exists($code, $overrides),
        ];
    }
    return $coupons;
}

function fetchAdminWebhookDeliveries($pdo): array
{
    $statement = $pdo->prepare(
        'SELECT id, order_id, status, attempts, next_attempt_at, last_error, created_at
         FROM webhook_deliveries
         WHERE status != :sent
         ORDER BY datetime(next_attempt_at) ASC, id ASC
         LIMIT 20'
    );
    $statement->execute([':sent' => 'sent']);
    return array_map(static fn(array $row): array => [
        'id' => (int)($row['id'] ?? 0),
        'order_id' => (string)($row['order_id'] ?? ''),
        'status' => (string)($row['status'] ?? ''),
        'attempts' => (int)($row['attempts'] ?? 0),
        'next_attempt_at' => (string)($row['next_attempt_at'] ?? ''),
        'last_error' => (string)($row['last_error'] ?? ''),
        'created_at' => (string)($row['created_at'] ?? ''),
    ], $statement->fetchAll());
}

function updateAdminOrderStatus($pdo, string $orderId, string $paymentStatus, string $fulfillmentStatus, string $note): void
{
    adminRequireId($orderId);
    adminRequireAllowed($paymentStatus, ADMIN_PAYMENT_STATUSES, 'Invalid payment status');
    adminRequireAllowed($fulfillmentStatus, ADMIN_FULFILLMENT_STATUSES, 'Invalid fulfillment status');

    $statement = $pdo->prepare(
        'UPDATE orders
         SET payment_status = :payment_status,
             fulfillment_status = :fulfillment_status,
             admin_note = :admin_note,
             updated_at = :updated_at
         WHERE id = :id'
    );
    $statement->execute([
        ':id' => $orderId,
        ':payment_status' => $paymentStatus,
        ':fulfillment_status' => $fulfillmentStatus,
        ':admin_note' => $note,
        ':updated_at' => gmdate('c'),
    ]);
}

function markAdminCodCollected($pdo, string $orderId): void
{
    adminRequireId($orderId);
    $now = gmdate('c');
    $statement = $pdo->prepare(
        "UPDATE orders
         SET payment_status = 'paid',
             payment_provider = 'cod',
             paid_at = COALESCE(paid_at, :paid_at),
             updated_at = :updated_at
         WHERE id = :id AND payment_method = 'cod'"
    );
    $statement->execute([
        ':id' => $orderId,
        ':paid_at' => $now,
        ':updated_at' => $now,
    ]);
}

function updateAdminInventoryStock($pdo, string $productId, int $stock): void
{
    adminRequireId($productId);
    if ($stock < 0) {
        throw new AdminError('Invalid stock value', 400);
    }
    $statement = $pdo->prepare(
        'UPDATE inventory
         SET stock = :stock
         WHERE product_id = :product_id'
    );
    $statement->execute([
        ':product_id' => $productId,
        ':stock' => $stock,
    ]);
}

function setAdminCouponOverride($pdo, string $code, bool $active): void
{
    adminRequireId($code);
    $statement = $pdo->prepare(
        'INSERT INTO coupon_overrides (code, active, updated_at)
         VALUES (:code, :active, :updated_at)
         ON CONFLICT(code) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at'
    );
    $statement->execute([
        ':code' => strtoupper($code),
        ':active' => $active ? 1 : 0,
        ':updated_at' => gmdate('c'),
    ]);
}

function retryAdminWebhook($pdo, int $deliveryId): void
{
    if ($deliveryId < 1) {
        throw new AdminError('Invalid delivery id', 400);
    }
    $statement = $pdo->prepare(
        'UPDATE webhook_deliveries
         SET status = :status,
             attempts = attempts + 1,
             next_attempt_at = :next_attempt_at,
             last_error = NULL
         WHERE id = :id'
    );
    $statement->execute([
        ':id' => $deliveryId,
        ':status' => 'pending',
        ':next_attempt_at' => gmdate('c'),
    ]);
}

function renderAdminCsv(array $orders): string
{
    $fp = fopen('php://temp', 'r+');
    if ($fp === false) {
        throw new RuntimeException('Could not open CSV buffer.');
    }
    fwrite($fp, implode(',', [
        'Order ID',
        'Created',
        'Customer',
        'Email',
        'Phone',
        'Payment Method',
        'Payment Status',
        'Fulfillment Status',
        'Total',
        'Coupon',
    ]) . "\n");
    foreach ($orders as $order) {
        fputcsv($fp, [
            adminCsvCell($order['id'] ?? ''),
            adminCsvCell($order['created_at'] ?? ''),
            adminCsvCell($order['customer_name'] ?? ''),
            adminCsvCell($order['customer_email'] ?? ''),
            adminCsvCell($order['customer_phone'] ?? ''),
            adminCsvCell($order['payment_method'] ?? ''),
            adminCsvCell($order['payment_status'] ?? ''),
            adminCsvCell($order['fulfillment_status'] ?? ''),
            adminCsvCell(formatAdminMoney((int)($order['total_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))),
            adminCsvCell($order['coupon_code'] ?? ''),
        ]);
    }
    rewind($fp);
    $csv = stream_get_contents($fp);
    fclose($fp);
    return $csv === false ? '' : $csv;
}

function renderAdminPage(array $listing, array $context = []): string
{
    $filters = is_array($context['filters'] ?? null) ? $context['filters'] : (is_array($listing['filters'] ?? null) ? $listing['filters'] : []);
    $csrf = (string)($context['csrf'] ?? '');
    $flash = (string)($context['flash'] ?? '');
    $detail = is_array($context['detail'] ?? null) ? $context['detail'] : null;
    $items = is_array($context['items'] ?? null) ? $context['items'] : [];
    $inventory = is_array($context['inventory'] ?? null) ? $context['inventory'] : [];
    $coupons = is_array($context['coupons'] ?? null) ? $context['coupons'] : [];
    $webhooks = is_array($context['webhooks'] ?? null) ? $context['webhooks'] : [];

    $flashHtml = $flash !== '' ? '<p class="flash">' . adminHtml($flash) . '</p>' : '';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>TinyCart Ops</title>'
        . '<style>'
        . 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f5f3;color:#151515}'
        . 'main{max-width:1240px;margin:0 auto;padding:24px 16px 36px}'
        . 'h1{font-size:24px;line-height:1.1;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}h3{font-size:14px;margin:0 0 8px}'
        . '.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}.muted,span{color:#666}.flash{border:1px solid #b7d7ba;background:#eef8ef;padding:10px 12px;margin:0 0 12px}'
        . '.panel{background:#fff;border:1px solid #ddd;margin-bottom:14px}.panel>header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #e7e7e7;padding:12px 14px}.panel>div{padding:14px}'
        . '.filters{display:grid;grid-template-columns:minmax(180px,1fr) repeat(3,160px) auto auto;gap:8px;align-items:end}.field span,label span{display:block;margin:0 0 5px;font-size:12px;font-weight:750;color:#333}'
        . 'input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #ccc;background:#fff;color:#111;padding:8px 9px;font:500 14px/1.3 system-ui,sans-serif}textarea{min-height:84px;resize:vertical}'
        . 'button,.btn{display:inline-flex;align-items:center;justify-content:center;min-height:36px;border:1px solid #111;background:#111;color:#fff;padding:0 12px;text-decoration:none;font:750 13px/1 system-ui,sans-serif;cursor:pointer}.btn.secondary,button.secondary{background:#fff;color:#111;border-color:#bbb}'
        . 'table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e8e8e8;font-size:13px}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#151515;color:#fff}'
        . 'code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.status{display:inline-block;border:1px solid #d2d2d2;background:#f7f7f7;padding:3px 6px;margin:0 4px 4px 0;font-size:12px}.money{font-weight:800}.empty{text-align:center;color:#666;padding:28px}.pager{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}'
        . '.grid{display:grid;grid-template-columns:1.25fr .75fr;gap:14px}.split{display:grid;grid-template-columns:1fr 1fr;gap:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}.inline{display:flex;gap:8px;align-items:center}.inline input{width:92px}.note{white-space:pre-wrap}.danger{border-color:#b23b3b;color:#b23b3b}.detail-list{display:grid;gap:5px;margin:0}.detail-list div{display:flex;gap:8px}.detail-list dt{min-width:112px;color:#666}.detail-list dd{margin:0}'
        . '@media(max-width:860px){.top,.grid,.split,.filters{display:block}.filters>*{margin-bottom:8px}table{display:block;overflow-x:auto}th,td{white-space:nowrap}.panel>header{display:block}.actions{margin-top:8px}}'
        . '</style></head><body><main>'
        . '<div class="top"><div><h1>TinyCart Ops</h1><p class="muted">Orders, COD collection, stock, coupons, and webhook health.</p></div></div>'
        . $flashHtml
        . '<div class="grid"><section>'
        . renderAdminFilters($filters)
        . renderAdminOrderTable($listing)
        . renderAdminDetail($detail, $items, $csrf)
        . '</section><aside>'
        . renderAdminInventoryPanel($inventory, $csrf)
        . renderAdminCouponPanel($coupons, $csrf)
        . renderAdminWebhookPanel($webhooks, $csrf)
        . '</aside></div>'
        . '</main></body></html>';
}

function renderAdminFilters(array $filters): string
{
    $export = adminQuery(['export' => 'csv', 'page' => null]);
    return '<section class="panel"><header><h2>Orders</h2><a class="btn secondary" href="' . adminHtml($export) . '">Export CSV</a></header><div>'
        . '<form class="filters" method="get">'
        . '<label class="field"><span>Search</span><input name="q" value="' . adminHtml($filters['q'] ?? '') . '" placeholder="Order, customer, phone"></label>'
        . '<label class="field"><span>Payment</span><select name="payment_method">' . adminOptions(ADMIN_PAYMENT_METHODS, (string)($filters['payment_method'] ?? ''), 'All methods') . '</select></label>'
        . '<label class="field"><span>Status</span><select name="payment_status">' . adminOptions(ADMIN_PAYMENT_STATUSES, (string)($filters['payment_status'] ?? ''), 'All payment') . '</select></label>'
        . '<label class="field"><span>Fulfillment</span><select name="fulfillment_status">' . adminOptions(ADMIN_FULFILLMENT_STATUSES, (string)($filters['fulfillment_status'] ?? ''), 'All fulfillment') . '</select></label>'
        . '<button type="submit">Filter</button><a class="btn secondary" href="?">Reset</a>'
        . '</form></div></section>';
}

function renderAdminOrderTable(array $listing): string
{
    $page = max(1, (int)($listing['page'] ?? 1));
    $orders = is_array($listing['orders'] ?? null) ? $listing['orders'] : [];
    $rows = '';

    foreach ($orders as $order) {
        $detailHref = adminQuery(['order' => $order['id'] ?? '', 'page' => $page]);
        $rows .= '<tr>'
            . '<td><a href="' . adminHtml($detailHref) . '"><code>' . adminHtml($order['id'] ?? '') . '</code></a><br><span>' . adminHtml($order['created_at'] ?? '') . '</span></td>'
            . '<td>' . adminHtml($order['customer_name'] ?? '') . '<br><span>' . adminHtml($order['customer_email'] ?? '') . '</span><br><span>' . adminHtml($order['customer_phone'] ?? '') . '</span></td>'
            . '<td class="money">' . adminHtml(formatAdminMoney((int)($order['total_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '<br><span>Discount ' . adminHtml(formatAdminMoney((int)($order['discount_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '</span></td>'
            . '<td>' . adminHtml($order['coupon_code'] ?? '') . '</td>'
            . '<td>' . adminStatusBadge($order['payment_method'] ?? '') . adminStatusBadge($order['payment_status'] ?? '') . '<br><span>' . adminHtml($order['payment_provider'] ?? '') . '</span></td>'
            . '<td>' . adminStatusBadge($order['fulfillment_status'] ?? '') . '</td>'
            . '<td class="note">' . adminHtml($order['admin_note'] ?? '') . '</td>'
            . '</tr>';
    }

    if ($rows === '') {
        $rows = '<tr><td colspan="7" class="empty">No orders found.</td></tr>';
    }

    return '<section class="panel"><div><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Coupon</th><th>Payment</th><th>Fulfillment</th><th>Note</th></tr></thead>'
        . '<tbody>' . $rows . '</tbody></table>'
        . renderAdminPager($listing) . '</div></section>';
}

function renderAdminPager(array $listing): string
{
    $page = max(1, (int)($listing['page'] ?? 1));
    $prev = !empty($listing['has_prev'])
        ? '<a class="btn secondary" href="' . adminHtml(adminQuery(['page' => $page - 1])) . '">Previous</a>'
        : '<span class="btn secondary">Previous</span>';
    $next = !empty($listing['has_next'])
        ? '<a class="btn secondary" href="' . adminHtml(adminQuery(['page' => $page + 1])) . '">Next</a>'
        : '<span class="btn secondary">Next</span>';
    return '<nav class="pager" aria-label="Pagination">' . $prev . $next . '</nav>';
}

function renderAdminDetail(?array $order, array $items, string $csrf): string
{
    if ($order === null) {
        return '';
    }

    $phone = adminPhone($order['customer_phone'] ?? '');
    $phoneLinks = $phone !== ''
        ? '<div class="actions"><a class="btn secondary" href="tel:' . adminHtml($phone) . '">Phone</a><a class="btn secondary" href="https://wa.me/' . adminHtml(ltrim($phone, '+')) . '">WhatsApp</a></div>'
        : '';
    $itemRows = '';
    foreach ($items as $item) {
        $itemRows .= '<tr><td>' . adminHtml($item['product_name'] ?? '') . '<br><span><code>' . adminHtml($item['product_id'] ?? '') . '</code> ' . adminHtml($item['options_json'] ?? '') . '</span></td>'
            . '<td>' . (int)($item['qty'] ?? 0) . '</td>'
            . '<td>' . adminHtml(formatAdminMoney((int)($item['price_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '</td>'
            . '<td>' . adminHtml(formatAdminMoney((int)($item['line_total_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '</td></tr>';
    }
    if ($itemRows === '') {
        $itemRows = '<tr><td colspan="4" class="empty">No line items.</td></tr>';
    }

    $codAction = (($order['payment_method'] ?? '') === 'cod' && ($order['payment_status'] ?? '') !== 'paid')
        ? '<form method="post">' . adminHiddenPost($csrf, ['action' => 'collect_cod', 'order_id' => $order['id'] ?? '']) . '<button type="submit">Cash collected</button></form>'
        : '';

    return '<section class="panel"><header><h2>Order detail <code>' . adminHtml($order['id'] ?? '') . '</code></h2>' . $phoneLinks . '</header><div>'
        . '<div class="split"><dl class="detail-list">'
        . '<div><dt>Customer</dt><dd>' . adminHtml($order['customer_name'] ?? '') . '</dd></div>'
        . '<div><dt>Phone</dt><dd>' . adminHtml($order['customer_phone'] ?? '') . '</dd></div>'
        . '<div><dt>Email</dt><dd>' . adminHtml($order['customer_email'] ?? '') . '</dd></div>'
        . '<div><dt>Address</dt><dd>' . adminHtml($order['customer_address'] ?? '') . '</dd></div>'
        . '</dl><dl class="detail-list">'
        . '<div><dt>Payment</dt><dd>' . adminStatusBadge($order['payment_method'] ?? '') . adminStatusBadge($order['payment_status'] ?? '') . adminHtml($order['payment_provider'] ?? '') . '</dd></div>'
        . '<div><dt>Paid at</dt><dd>' . adminHtml($order['paid_at'] ?? '') . '</dd></div>'
        . '<div><dt>Session</dt><dd><code>' . adminHtml($order['payment_session_id'] ?? '') . '</code></dd></div>'
        . '<div><dt>Source</dt><dd>' . adminHtml($order['page'] ?? '') . '</dd></div>'
        . '</dl></div>'
        . '<table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Line</th></tr></thead><tbody>' . $itemRows . '</tbody></table>'
        . '<form method="post" class="split" style="margin-top:12px">'
        . adminHiddenPost($csrf, ['action' => 'update_order', 'order_id' => $order['id'] ?? ''])
        . '<label><span>Payment status</span><select name="payment_status">' . adminOptions(ADMIN_PAYMENT_STATUSES, (string)($order['payment_status'] ?? ''), '') . '</select></label>'
        . '<label><span>Fulfillment</span><select name="fulfillment_status">' . adminOptions(ADMIN_FULFILLMENT_STATUSES, (string)($order['fulfillment_status'] ?? ''), '') . '</select></label>'
        . '<label style="grid-column:1/-1"><span>Admin note</span><textarea name="admin_note">' . adminHtml($order['admin_note'] ?? '') . '</textarea></label>'
        . '<div class="actions"><button type="submit">Save order</button></div>'
        . '</form>' . $codAction . '</div></section>';
}

function renderAdminInventoryPanel(array $inventory, string $csrf): string
{
    $rows = '';
    foreach ($inventory as $item) {
        $rows .= '<tr><td>' . adminHtml($item['name'] ?? '') . '<br><code>' . adminHtml($item['product_id'] ?? '') . '</code></td>'
            . '<td><form class="inline" method="post">' . adminHiddenPost($csrf, ['action' => 'update_inventory', 'product_id' => $item['product_id'] ?? ''])
            . '<input name="stock" type="number" min="0" value="' . adminHtml((string)($item['stock'] ?? 0)) . '"><button type="submit" class="secondary">Save</button></form></td></tr>';
    }
    if ($rows === '') {
        $rows = '<tr><td colspan="2" class="empty">No inventory rows.</td></tr>';
    }
    return '<section class="panel"><header><h2>Inventory</h2></header><div><table><thead><tr><th>Product</th><th>Stock</th></tr></thead><tbody>' . $rows . '</tbody></table></div></section>';
}

function renderAdminCouponPanel(array $coupons, string $csrf): string
{
    $rows = '';
    foreach ($coupons as $coupon) {
        $active = !empty($coupon['active']);
        $rows .= '<tr><td><code>' . adminHtml($coupon['code'] ?? '') . '</code><br><span>' . adminHtml($coupon['label'] ?? '') . '</span></td>'
            . '<td>' . adminStatusBadge($active ? 'active' : 'inactive') . (!empty($coupon['overridden']) ? '<span>Override</span>' : '') . '</td>'
            . '<td><form method="post">' . adminHiddenPost($csrf, [
                'action' => 'set_coupon',
                'code' => $coupon['code'] ?? '',
                'active' => $active ? '0' : '1',
            ]) . '<button type="submit" class="secondary">' . ($active ? 'Deactivate' : 'Activate') . '</button></form></td></tr>';
    }
    if ($rows === '') {
        $rows = '<tr><td colspan="3" class="empty">No configured coupons.</td></tr>';
    }
    return '<section class="panel"><header><h2>Coupon overrides</h2></header><div><table><thead><tr><th>Code</th><th>State</th><th>Action</th></tr></thead><tbody>' . $rows . '</tbody></table></div></section>';
}

function renderAdminWebhookPanel(array $webhooks, string $csrf): string
{
    $rows = '';
    foreach ($webhooks as $delivery) {
        $rows .= '<tr><td><code>' . (int)($delivery['id'] ?? 0) . '</code><br><span>' . adminHtml($delivery['order_id'] ?? '') . '</span></td>'
            . '<td>' . adminStatusBadge($delivery['status'] ?? '') . '<br><span>Attempts ' . (int)($delivery['attempts'] ?? 0) . '</span></td>'
            . '<td>' . adminHtml($delivery['next_attempt_at'] ?? '') . '<br><span>' . adminHtml($delivery['last_error'] ?? '') . '</span></td>'
            . '<td><form method="post">' . adminHiddenPost($csrf, [
                'action' => 'retry_webhook',
                'delivery_id' => (string)($delivery['id'] ?? ''),
            ]) . '<button type="submit" class="secondary">Retry now</button></form></td></tr>';
    }
    if ($rows === '') {
        $rows = '<tr><td colspan="4" class="empty">No pending or failed deliveries.</td></tr>';
    }
    return '<section class="panel"><header><h2>Webhook health</h2></header><div><table><thead><tr><th>Delivery</th><th>Status</th><th>Next</th><th>Action</th></tr></thead><tbody>' . $rows . '</tbody></table></div></section>';
}

function adminHiddenPost(string $csrf, array $fields): string
{
    $html = '<input type="hidden" name="_csrf" value="' . adminHtml($csrf) . '">';
    $html .= '<input type="hidden" name="return_to" value="' . adminHtml($_SERVER['REQUEST_URI'] ?? 'admin.php') . '">';
    foreach ($fields as $name => $value) {
        $html .= '<input type="hidden" name="' . adminHtml($name) . '" value="' . adminHtml($value) . '">';
    }
    return $html;
}

function adminOptions(array $values, string $selected, string $emptyLabel): string
{
    $html = $emptyLabel !== '' ? '<option value="">' . adminHtml($emptyLabel) . '</option>' : '';
    foreach ($values as $value) {
        $html .= '<option value="' . adminHtml($value) . '"' . ($value === $selected ? ' selected' : '') . '>' . adminHtml(ucwords(str_replace('_', ' ', $value))) . '</option>';
    }
    return $html;
}

function adminStatusBadge(mixed $value): string
{
    $text = adminCleanString($value, 80);
    if ($text === '') {
        return '';
    }
    return '<span class="status">' . adminHtml($text) . '</span>';
}

function adminPhone(mixed $value): string
{
    $phone = preg_replace('/[^0-9+]/', '', (string)$value) ?? '';
    if (str_starts_with($phone, '00')) {
        $phone = '+' . substr($phone, 2);
    }
    return $phone;
}

function adminRequireAllowed(string $value, array $allowed, string $message): void
{
    if (!in_array($value, $allowed, true)) {
        throw new AdminError($message, 400);
    }
}

function adminRequireId(string $id): void
{
    if ($id === '') {
        throw new AdminError('Missing identifier', 400);
    }
}

function adminCleanString(mixed $value, int $maxLength): string
{
    $value = is_scalar($value) ? (string)$value : '';
    $value = preg_replace('/[[:cntrl:]]/', '', $value) ?? '';
    $value = trim($value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
}

function adminCsvCell(mixed $value): string
{
    $text = (string)$value;
    if ($text !== '' && in_array($text[0], ['=', '+', '-', '@'], true)) {
        return "'" . $text;
    }
    return $text;
}

function formatAdminMoney(int $cents, string $currency): string
{
    return number_format($cents / 100, 2, '.', '') . ' ' . strtoupper($currency);
}

function adminHtml(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function adminQuery(array $overrides = []): string
{
    $params = is_array($_GET ?? null) ? $_GET : [];
    foreach ($overrides as $key => $value) {
        if ($value === null || $value === '') {
            unset($params[$key]);
        } else {
            $params[$key] = $value;
        }
    }
    $query = http_build_query($params);
    return $query === '' ? '?' : '?' . $query;
}

function adminFlash(?string $message = null): string
{
    startAdminSession();
    if ($message !== null) {
        $_SESSION['tc_admin_flash'] = $message;
        return '';
    }
    $flash = (string)($_SESSION['tc_admin_flash'] ?? '');
    unset($_SESSION['tc_admin_flash']);
    return $flash;
}

function adminRedirect(): void
{
    $target = adminCleanString($_POST['return_to'] ?? '', 600);
    if ($target === '' || preg_match('/^[a-z][a-z0-9+.-]*:/i', $target)) {
        $target = $_SERVER['PHP_SELF'] ?? 'admin.php';
    }
    header('Location: ' . $target, true, 303);
    exit;
}

function adminCsvResponse(string $csv): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="tinycart-orders.csv"');
    header('X-Content-Type-Options: nosniff');
    echo $csv;
    exit;
}

function adminTextResponse(string $message, int $status): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $message;
    exit;
}

final class AdminError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
