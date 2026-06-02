<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Allow: POST');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function lead_json(int $status, array $payload) {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  lead_json(405, ['ok' => false, 'error' => 'Method not allowed']);
}

$contentType = (string)($_SERVER['CONTENT_TYPE'] ?? '');
if ($contentType !== '' && stripos($contentType, 'application/json') === false && stripos($contentType, 'text/plain') === false) {
  lead_json(415, ['ok' => false, 'error' => 'Unsupported media type']);
}

$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
  $originHost = strtolower((string)parse_url($origin, PHP_URL_HOST));
  $allowedHosts = [
    'imamov-remont.ru',
    'www.imamov-remont.ru',
    strtolower(preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? ''))),
  ];
  $allowedHosts = array_values(array_filter(array_unique($allowedHosts)));
  if ($originHost === '' || !in_array($originHost, $allowedHosts, true)) {
    lead_json(403, ['ok' => false, 'error' => 'Forbidden origin']);
  }
}

$configPath = __DIR__ . '/lead-config.php';
$config = is_file($configPath) ? require $configPath : [];

$input = file_get_contents('php://input') ?: '';
if (strlen($input) > 20000) {
  lead_json(413, ['ok' => false, 'error' => 'Payload too large']);
}

$payload = json_decode($input, true);

if (!is_array($payload)) {
  lead_json(400, ['ok' => false, 'error' => 'Invalid JSON']);
}

function lead_value(array $payload, string $key): string {
  $value = isset($payload[$key]) ? (string) $payload[$key] : '';
  $value = trim(strip_tags($value));
  return function_exists('mb_substr') ? mb_substr($value, 0, 1200, 'UTF-8') : substr($value, 0, 2400);
}

function lead_header_value(string $value, string $fallback = ''): string {
  $value = trim(strip_tags($value));
  $value = preg_replace('/[\r\n]+/', ' ', $value);
  return $value !== '' ? $value : $fallback;
}

function lead_valid_bot_token(string $token): bool {
  if ($token === '' || strpos($token, 'PASTE_') === 0) {
    return false;
  }
  return (bool) preg_match('/^\d{5,}:[A-Za-z0-9_-]{20,}$/', $token);
}

function lead_valid_telegram_chat_id(string $chatId): bool {
  if ($chatId === '' || strpos($chatId, 'PASTE_') === 0) {
    return false;
  }
  return (bool) (
    preg_match('/^-?\d{3,32}$/', $chatId) ||
    preg_match('/^@[A-Za-z0-9_]{5,64}$/', $chatId)
  );
}

function lead_telegram_chat_ids(array $config): array {
  $items = [];
  if (isset($config['telegram_chat_id'])) {
    $items[] = (string) $config['telegram_chat_id'];
  }
  $extra = $config['telegram_chat_ids'] ?? [];
  if (is_string($extra)) {
    $extra = preg_split('/[\s,;]+/', $extra) ?: [];
  }
  if (is_array($extra)) {
    foreach ($extra as $chatId) {
      $items[] = (string) $chatId;
    }
  }

  $items = array_map('trim', $items);
  $items = array_filter($items, 'lead_valid_telegram_chat_id');
  return array_values(array_unique($items));
}

function lead_rate_limit_exceeded(int $limit = 12, int $windowSeconds = 600): bool {
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
  if (!filter_var($ip, FILTER_VALIDATE_IP)) {
    $ip = 'unknown';
  }

  $file = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'imamov_remont_lead_' . hash('sha256', $ip) . '.json';
  $now = time();
  $events = [];

  if (is_file($file)) {
    $raw = @file_get_contents($file);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    if (is_array($decoded)) {
      $events = $decoded;
    }
  }

  $events = array_values(array_filter($events, static function ($timestamp) use ($now, $windowSeconds): bool {
    return is_int($timestamp) && $timestamp > ($now - $windowSeconds);
  }));

  if (count($events) >= $limit) {
    return true;
  }

  $events[] = $now;
  @file_put_contents($file, json_encode($events), LOCK_EX);
  return false;
}

$name = lead_value($payload, 'name');
$phone = lead_value($payload, 'phone');
$object = lead_value($payload, 'object');
$area = lead_value($payload, 'area');
$finish = lead_value($payload, 'finish');
$channel = lead_value($payload, 'channel');
$source = lead_value($payload, 'source');
$message = lead_value($payload, 'message');
$website = lead_value($payload, 'website');
$allowedChannels = ['whatsapp', 'telegram', 'max'];
if (!in_array($channel, $allowedChannels, true)) {
  $channel = 'whatsapp';
}

if ($website !== '') {
  echo json_encode(['ok' => true, 'telegram' => false, 'mail' => false], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($name === '' || $phone === '' || $object === '') {
  lead_json(422, ['ok' => false, 'error' => 'Required lead fields are missing']);
}

$phoneDigits = preg_replace('/\D+/', '', $phone);
if (strlen($phoneDigits) < 7) {
  lead_json(422, ['ok' => false, 'error' => 'Invalid phone']);
}

if (lead_rate_limit_exceeded()) {
  header('Retry-After: 600');
  lead_json(429, ['ok' => false, 'error' => 'Too many requests']);
}

$lines = [
  'Новая заявка с сайта Имамов Ремонт',
  '',
  $source !== '' ? "Источник: {$source}" : null,
  $name !== '' ? "Имя: {$name}" : null,
  $phone !== '' ? "Телефон: {$phone}" : null,
  $object !== '' ? "Тип объекта: {$object}" : null,
  $area !== '' ? "Площадь: {$area} м2" : null,
  $finish !== '' ? "Уровень отделки: {$finish}" : null,
  $channel !== '' ? "Канал связи: {$channel}" : null,
  '',
  $message !== '' ? "Сообщение:\n{$message}" : null,
];

$text = implode("\n", array_values(array_filter($lines, static function ($line): bool {
  return $line !== null;
})));
$sentTelegram = false;
$sentMail = false;

$botToken = (string)($config['telegram_bot_token'] ?? '');
$chatIds = lead_telegram_chat_ids($config);

if (lead_valid_bot_token($botToken) && $chatIds !== [] && function_exists('curl_init')) {
  foreach ($chatIds as $chatId) {
    $telegramPayload = http_build_query([
      'chat_id' => $chatId,
      'text' => $text,
      'disable_web_page_preview' => 'true',
    ]);

    $ch = curl_init("https://api.telegram.org/bot{$botToken}/sendMessage");
    if ($ch !== false) {
      curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $telegramPayload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 8,
      ]);
      curl_exec($ch);
      $sentTelegram = $sentTelegram || (curl_errno($ch) === 0 && (int) curl_getinfo($ch, CURLINFO_HTTP_CODE) < 400);
      curl_close($ch);
    }
  }
}

$mailTo = (string)($config['mail_to'] ?? '');
$mailFrom = lead_header_value((string)($config['mail_from'] ?? ''), 'no-reply@imamov-remont.ru');
$mailSubject = lead_header_value((string)($config['mail_subject'] ?? ''), 'Новая заявка с сайта Имамов Ремонт');

$mailTo = filter_var($mailTo, FILTER_VALIDATE_EMAIL) ? $mailTo : '';
$mailFrom = filter_var($mailFrom, FILTER_VALIDATE_EMAIL) ? $mailFrom : 'no-reply@imamov-remont.ru';

if ($mailTo !== '') {
  $encodedSubject = '=?UTF-8?B?' . base64_encode($mailSubject) . '?=';
  $headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    "From: {$mailFrom}",
    "Reply-To: {$mailFrom}",
  ];
  $sentMail = mail($mailTo, $encodedSubject, $text, implode("\r\n", $headers));
}

if (!$sentTelegram && !$sentMail) {
  lead_json(500, ['ok' => false, 'error' => 'Lead delivery is not configured']);
}

echo json_encode([
  'ok' => true,
  'telegram' => $sentTelegram,
  'mail' => $sentMail,
], JSON_UNESCAPED_UNICODE);
