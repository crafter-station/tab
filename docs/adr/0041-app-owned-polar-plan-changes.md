# Polar Portal Owns Plan Changes

Tab sends active paid subscribers to the Polar Customer Portal for all plan changes instead of updating subscriptions from the app. Checkout remains only for users without an active paid Polar entitlement. Polar emits `subscription.updated` when a customer changes a subscription; Tab uses that webhook, along with `subscription.created`, `subscription.active`, `subscription.past_due`, and `subscription.revoked`, to reconcile cached D1 entitlements from the subscription `product_id`/`product` and status fields.
