<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Model\Deployment;

use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\HTTP\Client\Curl;
use MerchantDuo\CloudflareApo\Api\BuildServiceInterface;
use MerchantDuo\CloudflareApo\Api\PurgeServiceInterface;
use MerchantDuo\CloudflareApo\Model\Cloudflare\ApiClient;
use MerchantDuo\CloudflareApo\Model\Cloudflare\StatusService;
use MerchantDuo\CloudflareApo\Model\Config\Settings;
use Symfony\Component\Process\Process;

class OperationRunner
{
    public function __construct(
        private BuildServiceInterface $builds,
        private PurgeServiceInterface $purges,
        private Settings $settings,
        private StatusService $status,
        private ApiClient $api,
        private OperationQueue $queue,
        private Curl $http
    ) {
    }

    /** @param array<string, mixed> $operation @return array<string, mixed> */
    public function run(array $operation): array
    {
        $websiteId = (int) $operation['website_id'];
        return match ($operation['operation']) {
            'connection' => $this->status->connection($websiteId),
            'purge' => $this->purge(),
            'build' => $this->builds->build($websiteId),
            'deploy' => $this->deploy($websiteId, (bool) $operation['force']),
            'rollback' => $this->rollback($websiteId),
            default => throw new \InvalidArgumentException('Unsupported Cloudflare operation.'),
        };
    }

    /** @return array<string, mixed> */
    private function purge(): array
    {
        $this->purges->enqueueFullFlush();
        return ['queued' => true];
    }

    /** @return array<string, mixed> */
    private function deploy(int $websiteId, bool $force): array
    {
        $build = $this->builds->build($websiteId);
        $latest = $this->queue->latestSuccessfulDeploy($websiteId);
        if (!$force && $latest && $latest['build_hash'] === $build['buildHash']) {
            return $build + ['noOp' => true, 'cloudflareVersionId' => $latest['cloudflare_version_id']];
        }

        $workspace = (string) $build['workspace'];
        $token = $this->settings->secret('cloudflare/api_token', $websiteId);
        $secret = $this->settings->secret('general/purge_secret', $websiteId);
        $workerName = $this->settings->value('cloudflare/worker_name', $websiteId);
        if ($token === '' || $secret === '' || $workerName === '') {
            throw new LocalizedException(__('Cloudflare API token, Worker name, and purge signing secret are required for deployment.'));
        }

        $this->command(['npx', 'wrangler', 'secret', 'put', 'PURGE_SECRET', '--name', $workerName], $workspace, $token, $secret);
        $upload = $this->command(['npx', 'wrangler', 'versions', 'upload', '--name', $workerName], $workspace, $token);
        if (!preg_match('/(?:version(?:\s+id)?\s*[:=]\s*|Version\s+)([a-f0-9-]{8,})/i', $upload, $match)) {
            throw new LocalizedException(__('Cloudflare did not return an uploaded Worker version ID.'));
        }
        $versionId = $match[1];
        $previousVersionId = $this->activeVersion($websiteId);
        $this->command(['npx', 'wrangler', 'versions', 'deploy', $versionId, '--name', $workerName, '--yes'], $workspace, $token);
        $this->verifyHealth($websiteId);

        return $build + ['cloudflareVersionId' => $versionId, 'previousVersionId' => $previousVersionId];
    }

    /** @return array<string, mixed> */
    private function rollback(int $websiteId): array
    {
        $latest = $this->queue->latestSuccessfulDeploy($websiteId);
        $versionId = (string) ($latest['previous_version_id'] ?? '');
        if ($versionId === '') {
            throw new LocalizedException(__('No previous Cloudflare Worker version is recorded for this website.'));
        }
        $build = $this->builds->build($websiteId);
        $this->command(['npx', 'wrangler', 'versions', 'deploy', $versionId, '--name', $this->settings->value('cloudflare/worker_name', $websiteId), '--yes'], (string) $build['workspace'], $this->settings->secret('cloudflare/api_token', $websiteId));
        $this->verifyHealth($websiteId);
        return $build + ['cloudflareVersionId' => $versionId];
    }

    private function activeVersion(int $websiteId): ?string
    {
        $account = $this->settings->value('cloudflare/account_id', $websiteId);
        $worker = $this->settings->value('cloudflare/worker_name', $websiteId);
        $deployment = $this->api->get('accounts/' . rawurlencode($account) . '/workers/scripts/' . rawurlencode($worker) . '/deployments', $websiteId);
        return $deployment['result'][0]['versions'][0]['version_id'] ?? null;
    }

    private function verifyHealth(int $websiteId): void
    {
        $url = rtrim($this->settings->value('general/worker_url', $websiteId), '/') . '/health_check.php';
        $this->http->reset();
        $this->http->setOption(CURLOPT_TIMEOUT, 30);
        $this->http->get($url);
        if ($this->http->getStatus() < 200 || $this->http->getStatus() >= 500) {
            throw new LocalizedException(__('Worker health verification failed.'));
        }
    }

    private function command(array $command, string $workspace, string $token, ?string $input = null): string
    {
        $process = new Process($command, $workspace, ['CLOUDFLARE_API_TOKEN' => $token]);
        $process->setInput($input);
        $process->setTimeout(300);
        $process->run();
        if (!$process->isSuccessful()) {
            throw new LocalizedException(__('Cloudflare Worker command failed.'));
        }
        return mb_substr($process->getOutput() . $process->getErrorOutput(), -65536);
    }
}
