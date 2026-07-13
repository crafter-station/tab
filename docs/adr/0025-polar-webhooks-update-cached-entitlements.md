# Polar Meters And Webhooks Drive Cached Entitlements

Status: partially superseded by ADR-0043. Polar still owns paid subscription lifecycle and updates cached entitlements, but local Accepted Words are not Polar-metered cloud usage and only successful Deep Completes use the cloud allowance.

Tab uses Polar for billing, subscription management, and monthly autocomplete metering across all plans, including free users. Polar webhooks update cached user entitlements in D1 or KV, successful returned suggestions are ingested as Polar usage events, and the hot suggestion path reads cached entitlement and usage state instead of calling Polar synchronously on each suggestion request.
