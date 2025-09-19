resource "cloudflare_workers_kv_namespace" "fpc_cache" {
  account_id = var.account_id
  title      = "${var.subdomain != "" ? var.subdomain : "root"}-fpc-cache"
}
