<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Controller\Adminhtml\Operation;
class Deploy extends AbstractOperation { protected string $operation = 'deploy'; protected string $aclResource = 'MerchantDuo_CloudflareApo::deploy'; }
