<?php
declare(strict_types=1);

namespace MerchantDuo\CloudflareApo\Controller\Adminhtml\Operation;

use Magento\Backend\App\Action;
use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\Data\Form\FormKey\Validator;
use MerchantDuo\CloudflareApo\Model\Deployment\OperationService;

abstract class AbstractOperation extends Action implements HttpPostActionInterface
{
    protected const ADMIN_RESOURCE = 'MerchantDuo_CloudflareApo::config';
    protected string $operation = '';
    protected string $aclResource = '';

    public function __construct(Action\Context $context, private Validator $formKeyValidator, private OperationService $operations)
    {
        parent::__construct($context);
    }

    public function execute()
    {
        $resultRedirect = $this->resultRedirectFactory->create();
        if (!$this->formKeyValidator->validate($this->getRequest())) {
            $this->messageManager->addErrorMessage(__('Invalid form key.'));
            return $resultRedirect->setRefererUrl();
        }
        $websiteId = (int) $this->getRequest()->getParam('website', 0);
        $userId = $this->_auth->getUser() ? (int) $this->_auth->getUser()->getId() : null;
        try {
            $id = $this->operations->enqueue($this->operation, $websiteId, $userId, (bool) $this->getRequest()->getParam('force'));
            $this->messageManager->addSuccessMessage(__('Cloudflare operation %1 has been queued.', $id));
        } catch (\Throwable $exception) {
            $this->messageManager->addErrorMessage(__('Cloudflare operation could not be queued: %1', $exception->getMessage()));
        }
        return $resultRedirect->setRefererUrl();
    }

    protected function _isAllowed(): bool
    {
        return $this->_authorization->isAllowed($this->aclResource);
    }
}
