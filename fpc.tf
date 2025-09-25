resource "cloudflare_workers_kv_namespace" "fpc_cache" {
  account_id = var.account_id
  title      = "${var.subdomain != "" ? var.subdomain : "root"}-fpc-cache"
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

resource "cloudflare_workers_route" "fpc_route" {
  zone_id = data.cloudflare_zones.zone.result[0].id
  pattern = "${var.subdomain != "" ? "${var.subdomain}." : ""}${var.zone_name}/*"
  script  = cloudflare_workers_script.fpc.script_name
}

# Optional bypass routes: when enabled, these routes will NOT attach the worker (script = "")
resource "cloudflare_workers_route" "bypass" {
  for_each = toset(var.bypass_routes)
  zone_id  = data.cloudflare_zones.zone.result[0].id
  pattern  = "${var.subdomain != "" ? "${var.subdomain}." : ""}${var.zone_name}/${each.value}/*"
  script   = null
}
