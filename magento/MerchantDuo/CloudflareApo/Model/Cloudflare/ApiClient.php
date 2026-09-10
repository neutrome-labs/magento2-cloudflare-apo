<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Cloudflare;

use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\HTTP\Client\Curl;
use MerchantDuo\CloudflareApo\Model\Config\Settings;
use Psr\Log\LoggerInterface;

class ApiClient
{
    private const API_BASE = 'https://api.cloudflare.com/client/v4/';
    private const MAX_DEBUG_BODY_LENGTH = 4096;

    public function __construct(
        private Curl $http,
        private Settings $settings,
        private LoggerInterface $logger
    ) {
    }

    /** @return array<string, mixed> */
    public function get(string $path, int $websiteId): array
    {
        return $this->request('GET', $path, $websiteId);
    }

    /** @return array<string, mixed> */
    public function request(string $method, string $path, int $websiteId, ?string $body = null): array
    {
        $token = $this->settings->secret('cloudflare/api_token', $websiteId);
        if ($token === '') {
            throw new LocalizedException(__('A Cloudflare API token is required.'));
        }

        $url = self::API_BASE . ltrim($path, '/');
        $startedAt = microtime(true);
        $this->http->reset();
        $this->http->setOption(CURLOPT_TIMEOUT, 30);
        $this->http->addHeader('Authorization', 'Bearer ' . $token);
        $this->http->addHeader('Content-Type', 'application/json');
        try {
            if ($method === 'GET') {
                $this->http->get($url);
            } elseif ($method === 'POST') {
                $this->http->post($url, $body ?? '');
            } else {
                throw new \InvalidArgumentException('Unsupported Cloudflare API method.');
            }
            $status = $this->http->getStatus();
            $responseBody = $this->http->getBody();
        } catch (\Throwable $exception) {
            $this->log($method, $url, 0, '', microtime(true) - $startedAt, $exception->getMessage());
            throw new LocalizedException(__('Cloudflare API request failed.'));
        }

        $this->log($method, $url, $status, $responseBody, microtime(true) - $startedAt);
        try {
            $response = json_decode($responseBody, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new LocalizedException(__('Cloudflare returned an invalid API response.'));
        }
        if ($status < 200 || $status >= 300 || empty($response['success'])) {
            throw new LocalizedException(__('Cloudflare API request was rejected.'));
        }

        return $response;
    }

    private function log(string $method, string $url, int $status, string $body, float $duration, string $error = ''): void
    {
        if ($this->settings->value('logging/api_requests') !== '1' && $error === '') {
            return;
        }
        $context = [
            'method' => $method,
            'url' => strtok($url, '?'),
            'status' => $status,
            'duration_ms' => (int) round($duration * 1000),
        ];
        if ($error !== '') {
            $context['error'] = $this->redact($error);
        }
        if ($this->settings->value('logging/api_responses') === '1') {
            $context['response'] = $this->redact(mb_substr($body, 0, self::MAX_DEBUG_BODY_LENGTH));
        }
        $this->logger->info('Cloudflare API request', $context);
    }

    private function redact(string $value): string
    {
        return preg_replace('/(?i)(authorization|token|secret|signature)\\s*[:=]\\s*[^,\\s]+/', '$1=[REDACTED]', $value) ?? '[REDACTED]';
    }
}
