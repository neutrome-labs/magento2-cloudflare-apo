<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Deployment;

use Magento\Framework\App\ResourceConnection;
use Magento\Framework\Exception\LocalizedException;

class OperationQueue
{
    private const ACTIVE_OPERATIONS = ['build', 'deploy', 'rollback'];

    public function __construct(private ResourceConnection $resources)
    {
    }

    public function enqueue(string $operation, int $websiteId, ?int $actorUserId = null, bool $force = false): int
    {
        if (!in_array($operation, ['connection', 'build', 'deploy', 'rollback', 'purge'], true)) {
            throw new \InvalidArgumentException('Unsupported Cloudflare operation.');
        }
        $connection = $this->resources->getConnection();
        $table = $this->table();
        $lockName = 'merchantduo_cloudflare_apo_' . $websiteId;
        if ((int) $connection->fetchOne('SELECT GET_LOCK(?, 5)', [$lockName]) !== 1) {
            throw new LocalizedException(__('Unable to acquire the Cloudflare operation lock.'));
        }
        $connection->beginTransaction();
        try {
            if (in_array($operation, self::ACTIVE_OPERATIONS, true)) {
                $active = (int) $connection->fetchOne(
                    "SELECT COUNT(*) FROM {$table} WHERE website_id = ? AND operation IN ('build', 'deploy', 'rollback') AND state IN ('pending', 'running') FOR UPDATE",
                    [$websiteId]
                );
                if ($active > 0) {
                    throw new LocalizedException(__('A Worker build, deployment, or rollback is already running for this website.'));
                }
            }
            $connection->insert($table, [
                'website_id' => $websiteId,
                'operation' => $operation,
                'state' => 'pending',
                'force' => $force ? 1 : 0,
                'actor_user_id' => $actorUserId,
            ]);
            $id = (int) $connection->lastInsertId($table);
            $connection->commit();
            return $id;
        } catch (\Throwable $exception) {
            $connection->rollBack();
            throw $exception;
        } finally {
            $connection->query('SELECT RELEASE_LOCK(?)', [$lockName]);
        }
    }

    /** @return list<array<string, mixed>> */
    public function claim(int $limit = 5): array
    {
        $connection = $this->resources->getConnection();
        $table = $this->table();
        $connection->beginTransaction();
        try {
            $rows = $connection->fetchAll("SELECT * FROM {$table} WHERE state = 'pending' ORDER BY deployment_id ASC LIMIT " . max(1, min($limit, 20)) . ' FOR UPDATE');
            foreach ($rows as $row) {
                $connection->update($table, ['state' => 'running'], ['deployment_id = ?' => (int) $row['deployment_id']]);
            }
            $connection->commit();
            return $rows;
        } catch (\Throwable $exception) {
            $connection->rollBack();
            throw $exception;
        }
    }

    /** @return array<string, mixed> */
    public function get(int $id): array
    {
        $row = $this->resources->getConnection()->fetchRow('SELECT * FROM ' . $this->table() . ' WHERE deployment_id = ?', [$id]);
        if (!$row) {
            throw new \RuntimeException('Cloudflare operation was not found.');
        }
        return $row;
    }

    public function markRunning(int $id): void
    {
        $this->resources->getConnection()->update($this->table(), ['state' => 'running'], ['deployment_id = ?' => $id, 'state = ?' => 'pending']);
    }

    public function complete(int $id, array $result = []): void
    {
        $this->resources->getConnection()->update($this->table(), [
            'state' => 'complete',
            'source_hash' => $result['sourceHash'] ?? null,
            'config_hash' => $result['configHash'] ?? null,
            'build_hash' => $result['buildHash'] ?? null,
            'cloudflare_version_id' => $result['cloudflareVersionId'] ?? null,
            'previous_version_id' => $result['previousVersionId'] ?? null,
            'error_summary' => null,
        ], ['deployment_id = ?' => $id]);
    }

    public function fail(int $id, \Throwable $exception): void
    {
        $message = preg_replace('/(?i)(token|secret|authorization)\s*[:=]\s*[^,\s]+/', '$1=[REDACTED]', $exception->getMessage()) ?: 'Operation failed.';
        $this->resources->getConnection()->update($this->table(), ['state' => 'failed', 'error_summary' => mb_substr($message, 0, 4096)], ['deployment_id = ?' => $id]);
    }

    /** @return array<string, mixed>|null */
    public function latest(int $websiteId): ?array
    {
        $row = $this->resources->getConnection()->fetchRow('SELECT * FROM ' . $this->table() . ' WHERE website_id = ? ORDER BY deployment_id DESC LIMIT 1', [$websiteId]);
        return $row ?: null;
    }

    /** @return array<string, mixed>|null */
    public function latestSuccessfulDeploy(int $websiteId): ?array
    {
        $row = $this->resources->getConnection()->fetchRow("SELECT * FROM " . $this->table() . " WHERE website_id = ? AND operation = 'deploy' AND state = 'complete' ORDER BY deployment_id DESC LIMIT 1", [$websiteId]);
        return $row ?: null;
    }

    private function table(): string
    {
        return $this->resources->getTableName('merchantduo_cloudflare_apo_deployment');
    }
}
