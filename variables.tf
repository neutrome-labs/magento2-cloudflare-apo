variable "zone_name" {
  description = "The name of the Cloudflare zone (e.g., 'example.com')."
}

variable "subdomain" {
  description = "The subdomain for the Magento 2 store (e.g., 'store'). Leave empty for root domain."
  type        = string
  default     = ""
}

variable "api_token" {
  description = "Cloudflare API Token with permissions for Workers, KV, and DNS."
  sensitive   = true
}

variable "account_id" {
  description = "The Cloudflare account ID."
}

variable "bypass_static" {
  description = "If true, create a bypass route for /static/* so the worker is not applied to static assets."
  type        = bool
  default     = false
}

variable "bypass_media" {
  description = "If true, create a bypass route for /media/* so the worker is not applied to media assets."
  type        = bool
  default     = false
}
