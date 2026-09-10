<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Console\Command;

use Magento\Framework\Console\Cli;
use MerchantDuo\CloudflareApo\Model\Cloudflare\StatusService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class ConnectionCommand extends Command
{
    public function __construct(private StatusService $status, ?string $name = null)
    {
        parent::__construct($name);
    }

    protected function configure(): void
    {
        $this->setName('cloudflare-apo:worker:connection')
            ->setDescription('Validate the configured Cloudflare API token and Worker access.')
            ->addOption('website', null, InputOption::VALUE_REQUIRED, 'Website ID', 0);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln((string) json_encode($this->status->connection((int) $input->getOption('website')), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        return Cli::RETURN_SUCCESS;
    }
}
