<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Cron;

use MerchantDuo\CloudflareApo\Model\Deployment\OperationQueue;
use MerchantDuo\CloudflareApo\Model\Deployment\OperationRunner;

class RunOperations
{
    public function __construct(private OperationQueue $queue, private OperationRunner $runner)
    {
    }

    public function execute(): void
    {
        foreach ($this->queue->claim() as $operation) {
            try {
                $this->queue->complete((int) $operation['deployment_id'], $this->runner->run($operation));
            } catch (\Throwable $exception) {
                $this->queue->fail((int) $operation['deployment_id'], $exception);
            }
        }
    }
}
