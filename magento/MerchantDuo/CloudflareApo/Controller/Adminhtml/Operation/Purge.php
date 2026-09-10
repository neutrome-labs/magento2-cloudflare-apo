<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Controller\Adminhtml\Operation;
class Purge extends AbstractOperation { protected string $operation = 'purge'; protected string $aclResource = 'MerchantDuo_CloudflareApo::purge'; }
