# Worker Uses AI SDK And AI Gateway

Tabb's Hono Worker calls the model provider directly for MVP using the Vercel AI SDK through Vercel AI Gateway. The Worker remains the product API boundary for authentication, entitlement checks, rate limiting, request validation, prompt shaping, provider invocation, and response normalization, while AI Gateway provides provider routing and model access behind that boundary.
