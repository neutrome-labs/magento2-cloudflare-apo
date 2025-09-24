terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

provider "cloudflare" {
  api_token = var.api_token
}

data "cloudflare_zones" "zone" {
  name = var.zone_name
}
