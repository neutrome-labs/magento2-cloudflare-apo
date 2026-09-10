<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Logger;

use Magento\Framework\Logger\Handler\Base;
use Monolog\Logger;

class Handler extends Base
{
    protected $loggerType = Logger::INFO;
    protected $fileName = '/var/log/cloudflare_apo.log';
}
