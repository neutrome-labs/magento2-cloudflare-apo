<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Controller\Adminhtml\Operation;
class Rollback extends AbstractOperation { protected string $operation = 'rollback'; protected string $aclResource = 'MerchantDuo_CloudflareApo::rollback'; }
