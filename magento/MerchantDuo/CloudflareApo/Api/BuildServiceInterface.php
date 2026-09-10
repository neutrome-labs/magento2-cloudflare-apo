<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Api;
interface BuildServiceInterface { /** @return array<string,mixed> */ public function build(int $websiteId = 0): array; }
