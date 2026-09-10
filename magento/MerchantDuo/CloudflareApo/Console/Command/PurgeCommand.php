<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Console\Command;
use Magento\Framework\Console\Cli;
use MerchantDuo\CloudflareApo\Api\PurgeServiceInterface;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
class PurgeCommand extends Command { public function __construct(private PurgeServiceInterface $purges, ?string $name = null){parent::__construct($name);} protected function configure():void{$this->setName('cloudflare-apo:cache:purge');} protected function execute(InputInterface $input,OutputInterface $output):int{$output->writeln(json_encode($this->purges->flush()));return Cli::RETURN_SUCCESS;} }
