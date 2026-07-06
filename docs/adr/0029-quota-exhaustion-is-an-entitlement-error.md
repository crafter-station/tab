# Quota Exhaustion Is An Entitlement Error

When a user exhausts their monthly autocomplete quota, Tabb's suggestion API returns an entitlement error such as `402 Payment Required` with quota, usage, reset, and upgrade details. Quota exhaustion is not represented as an empty suggestions array, which remains reserved for successful requests where the API has no confident suggestion to show.
