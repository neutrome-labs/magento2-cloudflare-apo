<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Plugin\Adminhtml;

use Magento\Backend\Block\Cache;
use Magento\Framework\AuthorizationInterface;
use Magento\Framework\Data\Form\FormKey;
use Magento\Framework\UrlInterface;

class AddCachePurgeButton
{
    public function __construct(private AuthorizationInterface $authorization, private UrlInterface $url, private FormKey $formKey)
    {
    }

    public function beforeGetButtonsHtml(Cache $subject): void
    {
        if (!$this->authorization->isAllowed('MerchantDuo_CloudflareApo::purge') || $subject->getData('merchantduo_cloudflare_apo_purge_added')) {
            return;
        }
        $url = $this->url->getUrl('cloudflare_apo/operation/purge');
        $formKey = $this->formKey->getFormKey();
        $onclick = "var f=document.createElement('form');f.method='post';f.action='" . addslashes($url) . "';f.innerHTML='<input type=\"hidden\" name=\"form_key\" value=\"" . addslashes($formKey) . "\">';document.body.appendChild(f);f.submit();";
        $subject->addButton('merchantduo_cloudflare_apo_purge', [
            'label' => __('Flush Cloudflare Full Page Cache'),
            'title' => __('Queues a signed full-page-cache purge for every enabled website.'),
            'onclick' => $onclick,
            'class' => 'secondary',
        ], 0, 100);
        $subject->setData('merchantduo_cloudflare_apo_purge_added', true);
    }
}
