# Empty Suggestions Array For No Confident Suggestion

Tabb's suggestion API returns `200 OK` with a `suggestions` array, using an empty array when no confident suggestion should be shown. Errors are reserved for actual failures such as invalid requests, authentication failures, missing entitlement, rate limiting, or backend/provider errors.
