<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Block\System\Config;

use Magento\Backend\Block\Template\Context;
use Magento\Config\Block\System\Config\Form\Field;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Data\Form\Element\AbstractElement;
use MerchantDuo\CloudflareApo\Model\Deployment\OperationService;

class Actions extends Field
{
    protected $_template = 'MerchantDuo_CloudflareApo::system/config/actions.phtml';

    public function __construct(Context $context, private RequestInterface $request, private OperationService $operations, array $data = [])
    {
        parent::__construct($context, $data);
    }

    protected function _getElementHtml(AbstractElement $element): string
    {
        return $this->toHtml();
    }

    public function postUrl(string $operation): string
    {
        return $this->getUrl('cloudflare_apo/operation/' . $operation);
    }

    public function formKey(): string
    {
        return $this->getFormKey();
    }

    public function websiteId(): int
    {
        return (int) $this->request->getParam('website', 0);
    }

    /** @return array<string, mixed>|null */
    public function latest(): ?array
    {
        return $this->operations->latest($this->websiteId());
    }
}
