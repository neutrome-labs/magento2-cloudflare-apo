<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Console\Command;

use Magento\Framework\Console\Cli;
use MerchantDuo\CloudflareApo\Model\Deployment\OperationService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class OperationCommand extends Command
{
    public function __construct(private OperationService $operations, private string $operation, ?string $name = null)
    {
        parent::__construct($name);
    }

    protected function configure(): void
    {
        $this->setName('cloudflare-apo:worker:' . $this->operation)
            ->addOption('website', null, InputOption::VALUE_REQUIRED, 'Website ID', 0);
        if ($this->operation === 'deploy') {
            $this->addOption('force', null, InputOption::VALUE_NONE, 'Deploy even if the build hash is unchanged.');
        }
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $result = $this->operations->runNow($this->operation, (int) $input->getOption('website'), (bool) $input->getOption('force'));
        $output->writeln((string) json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        return Cli::RETURN_SUCCESS;
    }
}
