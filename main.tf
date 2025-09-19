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

resource "cloudflare_workers_script" "fpc" {
  account_id  = var.account_id
  script_name = "${var.subdomain != "" ? var.subdomain : "root"}-fpc"
  content     = file("workers/fpc.js")

  bindings = [
    {
      name         = "FPC_CACHE"
      namespace_id = cloudflare_workers_kv_namespace.fpc_cache.id
      type         = "kv_namespace"
    }
  ]
}

data "cloudflare_zones" "zone" {
  name = var.zone_name
}

resource "cloudflare_workers_route" "fpc_route" {
  zone_id = data.cloudflare_zones.zone.result[0].id
  pattern = "${var.subdomain != "" ? "${var.subdomain}." : ""}${var.zone_name}/*"
  script  = cloudflare_workers_script.fpc.script_name
}

# Optional bypass routes: when enabled, these routes will NOT attach the worker (script = "")
resource "cloudflare_workers_route" "bypass_static" {
  count   = var.bypass_static ? 1 : 0
  zone_id = data.cloudflare_zones.zone.result[0].id
  pattern = "${var.subdomain != "" ? "${var.subdomain}." : ""}${var.zone_name}/static/*"
  script  = ""
}

resource "cloudflare_workers_route" "bypass_media" {
  count   = var.bypass_media ? 1 : 0
  zone_id = data.cloudflare_zones.zone.result[0].id
  pattern = "${var.subdomain != "" ? "${var.subdomain}." : ""}${var.zone_name}/media/*"
  script  = ""
}
