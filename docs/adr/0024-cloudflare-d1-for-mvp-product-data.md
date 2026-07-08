# Cloudflare D1 For MVP Product Data

Tab uses Cloudflare D1 as the MVP database for durable product data such as users, devices, Personal Memory, memory mutations, subscription entitlement cache, settings, and metadata-only suggestion events. Cloudflare Queues handle background memory jobs, KV handles short-lived exchange/rate-limit/cache data, and R2 is not used for raw typing or suggestion storage by default.
