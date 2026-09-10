<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Model\Config;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Store\Model\ScopeInterface;
use Magento\Framework\Encryption\EncryptorInterface;
final class Settings {
 public function __construct(private ScopeConfigInterface $config, private EncryptorInterface $encryptor) {}
 public function value(string $path, int $websiteId = 0): string { return (string)$this->config->getValue('merchantduo_cloudflare_apo/'.$path, ScopeInterface::SCOPE_WEBSITE, $websiteId ?: null); }
 public function secret(string $path, int $websiteId = 0): string { $value=$this->value($path,$websiteId); return $value === '' ? '' : $this->encryptor->decrypt($value); }
 public function csv(string $path, int $websiteId = 0): array { return array_values(array_filter(array_map('trim', explode(',', $this->value($path,$websiteId))), static fn(string $value): bool => $value !== '')); }
 public function enabled(int $websiteId = 0): bool { return $this->value('general/enabled',$websiteId) === '1'; }
}
