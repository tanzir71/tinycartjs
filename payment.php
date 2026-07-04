<?php
declare(strict_types=1);

/**
 * TinyCart payment return/webhook handler.
 *
 * Stripe uses signed webhooks. PayPal returns here after payer approval and the
 * handler captures the order server-side before marking the TinyCart order paid.
 */

const PAYMENT_DB_PATH = __DIR__ . '/data/orders.sqlite';
const PAYMENT_ERROR_LOG_PATH = __DIR__ . '/data/payment_errors.log';
const STRIPE_WEBHOOK_SECRET = '';
const PAYPAL_CLIENT_ID = '';
const PAYPAL_SECRET = '';
const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const PAYMENT_HTTP_TIMEOUT_SECONDS = 12;

paymentMain();

function paymentMain(): void
{
    try {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $raw = file_get_contents('php://input');
            if ($raw === false || strlen($raw) > 128 * 1024) {
                throw new PaymentClientError('Invalid payload', 400);
            }
            $paid = stripePaidOrder($raw, $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '', STRIPE_WEBHOOK_SECRET);
            if ($paid !== null) {
                markOrderPaid(paymentDb(), $paid['order_id'], $paid['provider'], $paid['session_id']);
            }
            paymentJson(['ok' => true]);
        }

        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $orderId = paymentCleanString($_GET['order_id'] ?? '', 80);
            $token = paymentCleanString($_GET['token'] ?? '', 120);
            $paid = paypalCapturePaidOrder($token, $orderId);
            if ($paid === null) {
                throw new PaymentClientError('Payment not completed', 400);
            }
            markOrderPaid(paymentDb(), $paid['order_id'], $paid['provider'], $paid['session_id']);
            paymentHtml('Payment received. You can close this page.');
        }

        paymentJson(['ok' => false, 'error' => 'Method not allowed'], 405);
    } catch (PaymentClientError $error) {
        paymentJson(['ok' => false, 'error' => $error->getMessage()], $error->statusCode);
    } catch (Throwable $error) {
        paymentLogServerError($error);
        paymentJson(['ok' => false, 'error' => 'Unable to process payment.'], 500);
    }
}

function stripePaidOrder(string $raw, string $signatureHeader, string $secret): ?array
{
    if ($secret === '' || !stripeSignatureValid($raw, $signatureHeader, $secret)) {
        throw new PaymentClientError('Invalid Stripe signature', 400);
    }

    $event = json_decode($raw, true);
    if (!is_array($event) || ($event['type'] ?? '') !== 'checkout.session.completed') {
        return null;
    }
    $session = $event['data']['object'] ?? [];
    if (!is_array($session) || !in_array(($session['payment_status'] ?? ''), ['paid', 'no_payment_required'], true)) {
        return null;
    }

    $orderId = paymentCleanString($session['client_reference_id'] ?? '', 80);
    $sessionId = paymentCleanString($session['id'] ?? '', 120);
    if ($orderId === '' || $sessionId === '') {
        throw new PaymentClientError('Invalid Stripe session', 400);
    }

    return [
        'order_id' => $orderId,
        'provider' => 'stripe',
        'session_id' => $sessionId,
    ];
}

function stripeSignatureValid(string $raw, string $signatureHeader, string $secret): bool
{
    $timestamp = '';
    $signatures = [];
    foreach (explode(',', $signatureHeader) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($key === 't') {
            $timestamp = $value;
        } elseif ($key === 'v1') {
            $signatures[] = $value;
        }
    }
    if ($timestamp === '' || count($signatures) === 0) {
        return false;
    }

    $expected = hash_hmac('sha256', $timestamp . '.' . $raw, $secret);
    foreach ($signatures as $signature) {
        if (hash_equals($expected, $signature)) {
            return true;
        }
    }
    return false;
}

function paypalCapturePaidOrder(string $paypalOrderId, string $orderId, ?callable $http = null): ?array
{
    if ($paypalOrderId === '' || $orderId === '') {
        throw new PaymentClientError('Missing PayPal order', 400);
    }
    if (PAYPAL_CLIENT_ID === '' || PAYPAL_SECRET === '') {
        throw new RuntimeException('PayPal payments are not configured.');
    }
    $http = $http ?? 'paymentHttpRequest';

    $tokenResponse = $http(
        'POST',
        rtrim(PAYPAL_API_BASE, '/') . '/v1/oauth2/token',
        [
            'Authorization' => 'Basic ' . base64_encode(PAYPAL_CLIENT_ID . ':' . PAYPAL_SECRET),
            'Content-Type' => 'application/x-www-form-urlencoded',
        ],
        'grant_type=client_credentials'
    );
    $token = paymentProviderJson($tokenResponse)['access_token'] ?? '';
    if ($token === '') {
        throw new RuntimeException('PayPal token response was invalid.');
    }

    $captureResponse = $http(
        'POST',
        rtrim(PAYPAL_API_BASE, '/') . '/v2/checkout/orders/' . rawurlencode($paypalOrderId) . '/capture',
        [
            'Authorization' => 'Bearer ' . $token,
            'Content-Type' => 'application/json',
        ],
        '{}'
    );
    $capture = paymentProviderJson($captureResponse);
    if (($capture['status'] ?? '') !== 'COMPLETED') {
        return null;
    }

    return [
        'order_id' => $orderId,
        'provider' => 'paypal',
        'session_id' => paymentCleanString($capture['id'] ?? $paypalOrderId, 120),
    ];
}

function markOrderPaid($pdo, string $orderId, string $provider, string $sessionId): void
{
    $update = $pdo->prepare(
        "UPDATE orders
         SET payment_status = 'paid', payment_provider = :provider,
             payment_session_id = :session_id, paid_at = :paid_at
         WHERE id = :id"
    );
    $update->execute([
        ':id' => $orderId,
        ':provider' => $provider,
        ':session_id' => $sessionId,
        ':paid_at' => gmdate('c'),
    ]);
}

function paymentDb(): PDO
{
    $pdo = new PDO('sqlite:' . PAYMENT_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    return $pdo;
}

function paymentProviderJson(array $response): array
{
    $status = (int)($response['status'] ?? 0);
    $data = json_decode((string)($response['body'] ?? ''), true);
    if ($status < 200 || $status >= 300 || !is_array($data)) {
        throw new RuntimeException('Payment provider request failed.');
    }
    return $data;
}

function paymentHttpRequest(string $method, string $url, array $headers, string $body): array
{
    $headerLines = [];
    foreach ($headers as $name => $value) {
        $headerLines[] = $name . ': ' . $value;
    }
    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headerLines),
            'content' => $body,
            'timeout' => PAYMENT_HTTP_TIMEOUT_SECONDS,
            'ignore_errors' => true,
        ],
    ]);
    $raw = file_get_contents($url, false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches)) {
            $status = (int)$matches[1];
            break;
        }
    }
    return ['status' => $status, 'body' => $raw === false ? '' : $raw];
}

function paymentCleanString(mixed $value, int $maxLength): string
{
    $value = is_scalar($value) ? (string)$value : '';
    $value = preg_replace('/[[:cntrl:]]/', '', $value) ?? '';
    $value = trim($value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
}

function paymentLogServerError(Throwable $error): void
{
    $dir = dirname(PAYMENT_ERROR_LOG_PATH);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        return;
    }
    $line = gmdate('c') . ' ' . $error->getMessage() . ' ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL;
    error_log($line, 3, PAYMENT_ERROR_LOG_PATH);
}

function paymentJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function paymentHtml(string $message): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo '<!doctype html><meta charset="utf-8"><title>TinyCart Payment</title><p>' .
        htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') .
        '</p>';
    exit;
}

final class PaymentClientError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode = 400)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
