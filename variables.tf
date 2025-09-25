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

variable "bypass_routes" {
  description = "List of path prefixes (without leading slash) for which the worker should be bypassed"
  type    = list(string)
  default = ["static", "media", "rest", "graphql"]
}
