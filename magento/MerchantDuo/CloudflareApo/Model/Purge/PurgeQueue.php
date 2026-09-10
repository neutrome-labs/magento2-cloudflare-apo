<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Purge;

use Magento\Framework\App\ResourceConnection;
use MerchantDuo\CloudflareApo\Model\Support\CanonicalJson;

final class PurgeQueue
{
    private const STALE_RUNNING_MINUTES = 10;

    public function __construct(
        private ResourceConnection $resources,
        private CanonicalJson $json
    ) {
    }

    public function enqueue(array $payload, int $websiteId = 0): void
    {
        $this->resources->getConnection()->insert($this->table(), [
            'website_id' => $websiteId,
            'payload' => $this->json->encode($payload),
            'state' => 'pending',
        ]);
    }

    /** @return list<array<string, mixed>> */
    public function claim(int $limit, array $websiteIds): array
    {
        $websiteIds = array_values(array_unique(array_map('intval', $websiteIds)));
        if ($websiteIds === []) {
            return [];
        }

        $connection = $this->resources->getConnection();
        $limit = max(1, min($limit, 100));
        $table = $this->table();
        $websiteFilter = implode(',', $websiteIds);

        $connection->beginTransaction();
        try {
            $rows = $connection->fetchAll(
                "SELECT * FROM {$table}
                 WHERE website_id IN ({$websiteFilter})
                   AND ((state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP()))
                    OR (state = 'running' AND updated_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL " . self::STALE_RUNNING_MINUTES . " MINUTE)))
                 ORDER BY queue_id ASC
                 LIMIT {$limit} FOR UPDATE"
            );
            foreach ($rows as $row) {
                $connection->update($table, ['state' => 'running'], ['queue_id = ?' => (int) $row['queue_id']]);
            }
            $connection->commit();
        } catch (\Throwable $exception) {
            $connection->rollBack();
            throw $exception;
        }

        return $rows;
    }

    public function complete(int $queueId): void
    {
        $this->update($queueId, ['state' => 'complete', 'last_error' => null]);
    }

    public function retry(int $queueId, int $attempts, string $error): void
    {
        $delay = min(3600, 2 ** min($attempts, 10));
        $this->update($queueId, [
            'state' => 'pending',
            'attempts' => $attempts,
            'next_attempt_at' => gmdate('Y-m-d H:i:s', time() + $delay),
            'last_error' => $this->error($error),
        ]);
    }

    public function fail(int $queueId, int $attempts, string $error): void
    {
        $this->update($queueId, [
            'state' => 'failed',
            'attempts' => $attempts,
            'last_error' => $this->error($error),
        ]);
    }

    /** @param array<string, mixed> $data */
    private function update(int $queueId, array $data): void
    {
        $this->resources->getConnection()->update($this->table(), $data, ['queue_id = ?' => $queueId]);
    }

    private function table(): string
    {
        return $this->resources->getTableName('merchantduo_cloudflare_apo_purge_queue');
    }

    private function error(string $error): string
    {
        return mb_substr($error, 0, 4096);
    }
}
