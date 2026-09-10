<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Model\Build;
use MerchantDuo\CloudflareApo\Model\Config\Settings;
use Magento\Store\Model\StoreManagerInterface;
use Magento\Framework\Exception\LocalizedException;
final class ProjectConfigFactory {
 public function __construct(private Settings $settings, private StoreManagerInterface $stores) {}
 /** Build only allowlisted config values; no admin input becomes executable code. */
 public function create(int $websiteId = 0): array {
  $host=$this->settings->value('origin/host',$websiteId); if (!preg_match('/^[a-z0-9.-]+(?::[0-9]+)?$/i',$host)) throw new LocalizedException(__('A valid origin host is required.'));
  $site=(string)($websiteId ?: $this->stores->getDefaultStoreView()->getWebsiteId());
  return ['schema'=>'magento2-cloudflare-apo/v3','siteId'=>'website-'.$site,'origin'=>['host'=>$host,'protocol'=>$this->settings->value('origin/protocol',$websiteId) ?: 'https:'],'cache'=>['ttlSeconds'=>$this->positive('cache/ttl',$websiteId),'staleSeconds'=>$this->nonNegative('cache/stale',$websiteId),'statuses'=>array_map('intval',$this->settings->csv('cache/statuses',$websiteId)),'mimeTypes'=>$this->settings->csv('cache/mime_types',$websiteId)],'request'=>['marketingParameters'=>$this->settings->csv('request/marketing_parameters',$websiteId),'excludedPathPrefixes'=>['/admin','/customer','/checkout','/cart','/wishlist','/sales','/rest/','/onestepcheckout','/password','/section/load'],'staticPathPrefixes'=>['/media/','/static/','/pub/media/','/pub/static/'],'healthPathPrefixes'=>['/health_check.php','/pub/health_check.php'],'varyCookies'=>$this->settings->csv('request/vary_cookies',$websiteId),'varyHeaders'=>$this->settings->csv('request/vary_headers',$websiteId),'allowOriginCookies'=>['X-Magento-Vary','store','currency'],'varyOnDevice'=>$this->settings->value('request/vary_on_device',$websiteId)==='1','graphqlPath'=>$this->settings->value('request/graphql_path',$websiteId) ?: '/graphql'],'plugins'=>['debugHeaders'=>false,'returnClaims'=>true,'replaceOriginLinks'=>false,'mergedCssGuard'=>false],'purge'=>['path'=>$this->settings->value('general/purge_path',$websiteId) ?: '/__fpc/purge','maxClockSkewSeconds'=>300,'maxItemsPerRequest'=>100]];
 }
 private function positive(string $path,int $websiteId): int { $value=(int)$this->settings->value($path,$websiteId); if($value<1) throw new LocalizedException(__('%1 must be positive.',$path)); return $value; }
 private function nonNegative(string $path,int $websiteId): int { $value=(int)$this->settings->value($path,$websiteId); if($value<0) throw new LocalizedException(__('%1 must not be negative.',$path)); return $value; }
}
