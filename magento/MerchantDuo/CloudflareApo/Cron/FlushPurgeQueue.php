<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Cron;
use MerchantDuo\CloudflareApo\Api\PurgeServiceInterface;
final class FlushPurgeQueue { public function __construct(private PurgeServiceInterface $purges) {} public function execute(): void { $this->purges->flush(); } }
