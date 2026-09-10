<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Observer;
use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use MerchantDuo\CloudflareApo\Api\PurgeServiceInterface;
final class QueueFullPurge implements ObserverInterface { public function __construct(private PurgeServiceInterface $purges) {} public function execute(Observer $observer): void { $this->purges->enqueueFullFlush(); } }
