<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Config\Source;

use Magento\Framework\Data\OptionSourceInterface;

class DeploymentMode implements OptionSourceInterface
{
    public function toOptionArray(): array
    {
        return [
            ['value' => 'local', 'label' => __('Local Node.js')],
            ['value' => 'workers_builds', 'label' => __('Cloudflare Workers Builds (coming soon)'), 'disabled' => true],
        ];
    }
}
