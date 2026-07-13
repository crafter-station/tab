# Quota Counts Returned Suggestions

Status: superseded by ADR-0043.

Tab counts an autocomplete against monthly plan quota only when the suggestion API returns at least one suggestion, and those successful returned suggestions are ingested as Polar usage events for the autocomplete meter. Empty successful responses, failed requests, and errors do not consume autocomplete quota, while separate rate limits protect the backend and model provider from excessive request volume.
