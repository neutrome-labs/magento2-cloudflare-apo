<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Model\Support;
final class CanonicalJson {
 /** Recursively sort object keys while retaining array order, then encode deterministically. */
 public function encode(array $value): string { return json_encode($this->sort($value), JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE); }
 private function sort(array $value): array { if (!array_is_list($value)) ksort($value, SORT_STRING); foreach ($value as $key => $child) if (is_array($child)) $value[$key]=$this->sort($child); return $value; }
 public function hash(array $value): string { return hash('sha256', $this->encode($value)); }
}
