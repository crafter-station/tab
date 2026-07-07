import { planQuotas, type PlanId } from "@tabb/billing";
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function formatPlanName(planId: string) {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function formatMonthlyPrice(monthlyPriceUsd: number) {
  return monthlyPriceUsd === 0 ? "Free" : `$${monthlyPriceUsd}/mo`;
}

function PricingPage() {
  const plans = Object.entries(planQuotas).map(([planId, plan]) => ({ planId: planId as PlanId, ...plan }));

  return (
    <>
      <h1>Pricing</h1>
      <p className="lead">Choose the plan that fits how much you write. Upgrade or downgrade at any time.</p>
      <div className="pricing-grid">
        {plans.map((plan) => {
          const name = formatPlanName(plan.planId);
          return (
            <article className="card" key={plan.planId}>
              <h2>{name}</h2>
              <div className="price">{formatMonthlyPrice(plan.monthlyPriceUsd)}</div>
              <p>{plan.monthlyAutocompleteSuggestions.toLocaleString()} autocompletes per month</p>
              <p>Personal Memory included</p>
              {plan.planId === "free" ? <span className="muted">Free forever</span> : <a className="button" href={`/billing/checkout?plan=${plan.planId}`}>Choose {name}</a>}
            </article>
          );
        })}
      </div>
    </>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "pricing", component: PricingPage });
