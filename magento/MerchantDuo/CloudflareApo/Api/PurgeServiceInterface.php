<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Api;
interface PurgeServiceInterface { public function enqueueTags(array $tags): void; public function enqueueFullFlush(): void; /** @return array<string,mixed> */ public function flush(): array; }
