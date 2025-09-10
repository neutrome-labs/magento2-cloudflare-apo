variable "zone_name" {
  description = "The name of the Cloudflare zone (e.g., 'example.com')."
}

variable "subdomain" {
  description = "The subdomain for the Magento 2 store (e.g., 'store')."
}

variable "api_token" {
  description = "Cloudflare API Token with permissions for Workers, KV, and DNS."
  sensitive   = true
}

variable "account_id" {
  description = "The Cloudflare account ID."
}
