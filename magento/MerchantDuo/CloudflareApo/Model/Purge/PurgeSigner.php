<?php
declare(strict_types=1);
namespace MerchantDuo\CloudflareApo\Model\Purge;
use MerchantDuo\CloudflareApo\Model\Config\Settings;
use MerchantDuo\CloudflareApo\Model\Support\CanonicalJson;
final class PurgeSigner {
 public function __construct(private Settings $settings,private CanonicalJson $json) {}
 /** @return array{body:string,headers:array<string,string>} */ public function sign(array $payload,int $websiteId=0): array { $body=$this->json->encode($payload); $timestamp=(string)time(); $nonce=rtrim(strtr(base64_encode(random_bytes(24)),'+/','-_'),'='); $secret=$this->settings->secret('general/purge_secret',$websiteId); if($secret==='') throw new \RuntimeException('Purge signing secret is not configured'); return ['body'=>$body,'headers'=>['Content-Type'=>'application/json','X-Purge-Timestamp'=>$timestamp,'X-Purge-Nonce'=>$nonce,'X-Purge-Signature'=>hash_hmac('sha256',$timestamp.'.'.$nonce.'.'.$body,$secret)]]; }
}
