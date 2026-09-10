<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Console\Command;

use Magento\Framework\Console\Cli;
use MerchantDuo\CloudflareApo\Api\BuildServiceInterface;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class BuildWorkerCommand extends Command
{
    public function __construct(private BuildServiceInterface $builds, ?string $name = null)
    {
        parent::__construct($name);
    }

    protected function configure(): void
    {
        $this->setName('cloudflare-apo:worker:build')
            ->setDescription('Build the configured Worker in an isolated Magento var workspace.')
            ->addOption('website', null, InputOption::VALUE_REQUIRED, 'Website ID', 0);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $report = $this->builds->build((int) $input->getOption('website'));
        $output->writeln((string) json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        return Cli::RETURN_SUCCESS;
    }
}
