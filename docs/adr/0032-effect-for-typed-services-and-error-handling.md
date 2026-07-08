# Effect For Typed Services And Error Handling

Tab uses Effect for typed services, explicit errors, dependency management, retries, background workflows, and shared business logic across the API, desktop, and shared packages where appropriate. Runtime-specific integration code may stay thin, but domain policies such as memory guardrails, billing checks, and suggestion orchestration should use Effect when it improves correctness and composability.
