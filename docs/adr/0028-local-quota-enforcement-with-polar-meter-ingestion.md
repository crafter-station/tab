# Local Quota Enforcement With Polar Meter Ingestion

Tab enforces monthly autocomplete quota on the hot suggestion path using local D1 usage state derived from the user's plan, while successful returned suggestions are ingested into Polar meters for billing and customer usage reporting. The backend should not rely on a synchronous Polar balance check for each suggestion request, and queued ingestion should handle retries for Polar event delivery.
