# Cloudflare Worker FPC for Magento 2

This Terraform module deploys a Cloudflare Worker to act as a Full Page Cache (FPC) for a Magento 2 store. It uses Cloudflare KV for caching and configuration, and implements a stale-while-revalidate strategy to ensure high performance and availability.

## Features

- **Stale-While-Revalidate:** Serves stale content while fetching a fresh version in the background, ensuring users always get a fast response.
- **KV-based Configuration:** Cache behavior (TTL, excluded paths, etc.) is managed via a KV namespace, allowing for changes without redeploying the worker.
- **Dynamic Cookie-based Cache Bypass:** Automatically bypasses the cache for users with active sessions or items in their cart.
- **Secure Purging:** Includes a secure endpoint to purge the cache for a specific URL.
- **Cache Status Headers:** Adds `X-FPC-Cache` (HIT, MISS, STALE) headers to responses for easy debugging.

## How to Use

### Prerequisites

- Terraform installed
- A Cloudflare account with a domain configured
- A Cloudflare API Token with the following permissions:
  - `Workers Scripts: Edit`
  - `Workers KV Storage: Write`
  - `Zone: Read`
  - `DNS: Edit`

### Deployment

1.  **Clone this repository or use it as a module.**

2.  **Create a `terraform.tfvars` file** in this directory with the following content:

    ```hcl
    account_id = "YOUR_account_id"
    api_token  = "YOUR_api_token"
    zone_name             = "your-domain.com"
    subdomain             = "store"
    ```

3.  **Initialize Terraform:**

    ```bash
    terraform init
    ```

4.  **Apply the Terraform configuration:**

    ```bash
    terraform apply
    ```

### Configuration

After the first run, the worker will populate the `FPC_CONFIG` KV namespace with a default configuration. You can edit this configuration directly in the Cloudflare dashboard (`Workers & Pages` -> `KV`).

The default configuration is:

```json
{
  "ttl": 3600,
  "purge_secret": "your-default-secret",
  "included_mimetypes": ["text/html", "application/json"],
  "excluded_paths": ["/admin", "/customer", "/checkout", "/wishlist"],
  "vary_on_params": ["utm_source", "utm_medium"]
}
```

**Important:** Change the `purge_secret` to a secure, unique value.

### Purging the Cache

To purge the cache for a specific URL, send a `PURGE` request to that URL with the correct secret header:

```bash
curl -X PURGE "https://store.your-domain.com/some-page" \
     -H "X-Purge-Secret: YOUR_CONFIGURED_SECRET"
