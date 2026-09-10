<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Deployment;

class OperationService
{
    public function __construct(private OperationQueue $queue, private OperationRunner $runner)
    {
    }

    public function enqueue(string $operation, int $websiteId, ?int $actorUserId = null, bool $force = false): int
    {
        return $this->queue->enqueue($operation, $websiteId, $actorUserId, $force);
    }

    /** @return array<string, mixed> */
    public function runNow(string $operation, int $websiteId, bool $force = false): array
    {
        $id = $this->enqueue($operation, $websiteId, null, $force);
        $this->queue->markRunning($id);
        try {
            $result = $this->runner->run($this->queue->get($id));
            $this->queue->complete($id, $result);
            return ['operationId' => $id] + $result;
        } catch (\Throwable $exception) {
            $this->queue->fail($id, $exception);
            throw $exception;
        }
    }

    /** @return array<string, mixed>|null */
    public function latest(int $websiteId): ?array
    {
        return $this->queue->latest($websiteId);
    }
}
