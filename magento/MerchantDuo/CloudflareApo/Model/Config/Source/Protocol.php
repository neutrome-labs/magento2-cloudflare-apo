<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Model\Config\Source;
use Magento\Framework\Data\OptionSourceInterface;
final class Protocol implements OptionSourceInterface { public function toOptionArray(): array { return [['value' => 'https:', 'label' => 'HTTPS'], ['value' => 'http:', 'label' => 'HTTP']]; } }
