resource "cloudflare_workers_kv_namespace" "fpc_cache" {
  account_id = var.account_id
  title      = "${var.subdomain}-fpc-cache"
}

resource "cloudflare_workers_kv_namespace" "fpc_config" {
  account_id = var.account_id
  title      = "${var.subdomain}-fpc-config"
}

resource "cloudflare_workers_kv" "fpc_config_init" {
  account_id = var.account_id
  namespace_id = cloudflare_workers_kv_namespace.fpc_config.id
  key_name     = "config"
  value        = file("${path.module}/config.fpc.json")
}
