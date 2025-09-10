resource "cloudflare_workers_kv_namespace" "fpc_cache" {
  account_id = var.account_id
  title      = "${var.subdomain}-fpc-cache"
}

resource "cloudflare_workers_kv_namespace" "fpc_config" {
  account_id = var.account_id
  title      = "${var.subdomain}-fpc-config"
}
