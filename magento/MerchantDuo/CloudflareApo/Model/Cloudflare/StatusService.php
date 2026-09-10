<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Cloudflare;

use Magento\Framework\Exception\LocalizedException;
use MerchantDuo\CloudflareApo\Model\Config\Settings;

class StatusService
{
    public function __construct(private ApiClient $api, private Settings $settings)
    {
    }

    /** @return array<string, mixed> */
    public function connection(int $websiteId = 0): array
    {
        $accountId = $this->settings->value('cloudflare/account_id', $websiteId);
        $workerName = $this->settings->value('cloudflare/worker_name', $websiteId);
        if (!preg_match('/^[a-f0-9]{32}$/i', $accountId) || !preg_match('/^[a-z0-9][a-z0-9_-]{0,62}$/i', $workerName)) {
            throw new LocalizedException(__('A valid Cloudflare account ID and Worker name are required.'));
        }
        $token = $this->api->get('user/tokens/verify', $websiteId);
        $scripts = $this->api->get('accounts/' . rawurlencode($accountId) . '/workers/scripts', $websiteId);
        $installed = false;
        foreach ($scripts['result'] ?? [] as $script) {
            if (($script['id'] ?? '') === $workerName) {
                $installed = true;
                break;
            }
        }

        return [
            'token_status' => $token['result']['status'] ?? 'unknown',
            'worker_name' => $workerName,
            'worker_installed' => $installed,
        ];
    }
}
