# Separate Fast Suggestion And Background Memory Generation

Status: superseded by ADR-0040

Tab uses separate model calls for suggestion generation and memory maintenance. The suggestion path fetches relevant active Personal Memory and returns a suggestion as quickly as possible, while a background memory generation path can take longer and use tools to read, create, or update Personal Memory without blocking the user's autocomplete experience.
