<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Purge;

use Magento\Framework\HTTP\Client\Curl;
use MerchantDuo\CloudflareApo\Api\PurgeServiceInterface;
use MerchantDuo\CloudflareApo\Model\Config\Settings;
use Magento\Store\Model\StoreManagerInterface;

final class PurgeService implements PurgeServiceInterface
{
    private const MAX_ITEMS_PER_REQUEST = 100;
    private const MAX_ATTEMPTS = 8;

    public function __construct(
        private PurgeQueue $queue,
        private Settings $settings,
        private StoreManagerInterface $storeManager,
        private PurgeSigner $signer,
        private Curl $http
    ) {
    }

    public function enqueueTags(array $tags): void
    {
        $tags = array_values(array_unique(array_filter(array_map(
            static fn ($tag): string => strtolower(trim((string) $tag)),
            $tags
        ), static fn (string $tag): bool => preg_match('/^[\x21-\x7e]{1,1024}$/', $tag) === 1)));

        foreach ($this->enabledWebsiteIds() as $websiteId) {
            foreach (array_chunk($tags, self::MAX_ITEMS_PER_REQUEST) as $chunk) {
                $this->queue->enqueue(['tags' => $chunk], $websiteId);
            }
        }
    }

    public function enqueueFullFlush(): void
    {
        foreach ($this->enabledWebsiteIds() as $websiteId) {
            $this->queue->enqueue(['purgeEverything' => true], $websiteId);
        }
    }

    public function flush(): array
    {
        $result = ['sent' => 0, 'retried' => 0, 'failed' => 0];
        foreach ($this->queue->claim(25, $this->enabledWebsiteIds()) as $row) {
            $queueId = (int) $row['queue_id'];
            $attempts = (int) $row['attempts'] + 1;
            try {
                $payload = json_decode((string) $row['payload'], true, 512, JSON_THROW_ON_ERROR);
                $signed = $this->signer->sign($payload, (int) $row['website_id']);
                $this->http->reset();
                $this->http->setOption(CURLOPT_TIMEOUT, 30);
                foreach ($signed['headers'] as $name => $value) {
                    $this->http->addHeader($name, $value);
                }
                $this->http->post($this->endpoint((int) $row['website_id']), $signed['body']);
                $status = $this->http->getStatus();
            } catch (\JsonException $exception) {
                $this->queue->fail($queueId, $attempts, 'Invalid queued purge payload: ' . $exception->getMessage());
                $result['failed']++;
                continue;
            } catch (\Throwable $exception) {
                $this->recordDeliveryFailure($queueId, $attempts, $exception->getMessage(), $result);
                continue;
            }

            if ($status >= 200 && $status < 300) {
                $this->queue->complete($queueId);
                $result['sent']++;
            } elseif ($this->isTransientStatus($status)) {
                $this->recordDeliveryFailure($queueId, $attempts, 'Worker returned HTTP ' . $status, $result);
            } else {
                $this->queue->fail($queueId, $attempts, 'Worker returned HTTP ' . $status);
                $result['failed']++;
            }
        }

        return $result;
    }

    /** @param array<string, int> $result */
    private function recordDeliveryFailure(int $queueId, int $attempts, string $error, array &$result): void
    {
        if ($attempts >= self::MAX_ATTEMPTS) {
            $this->queue->fail($queueId, $attempts, $error);
            $result['failed']++;
            return;
        }

        $this->queue->retry($queueId, $attempts, $error);
        $result['retried']++;
    }

    /** @return list<int> */
    private function enabledWebsiteIds(): array
    {
        $websiteIds = [];
        foreach ($this->storeManager->getWebsites() as $website) {
            $websiteId = (int) $website->getId();
            if ($this->settings->enabled($websiteId)) {
                $websiteIds[] = $websiteId;
            }
        }

        return $websiteIds;
    }

    private function endpoint(int $websiteId): string
    {
        $base = $this->settings->value('general/worker_url', $websiteId);
        $path = $this->settings->value('general/purge_path', $websiteId) ?: '/__fpc/purge';
        if (!filter_var($base, FILTER_VALIDATE_URL) || !str_starts_with($base, 'https://') || !str_starts_with($path, '/')) {
            throw new \RuntimeException('A HTTPS Worker URL and absolute purge path are required for purge delivery');
        }

        return rtrim($base, '/') . $path;
    }

    private function isTransientStatus(int $status): bool
    {
        return $status === 408 || $status === 425 || $status === 429 || $status >= 500;
    }
}
