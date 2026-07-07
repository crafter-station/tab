import { planQuotas, type PlanId } from "@tabb/billing";
import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tabb/ui";
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
      <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Pricing</h1>
      <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Choose the plan that fits how much you write. Upgrade or downgrade at any time.</p>
      <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {plans.map((plan) => {
          const name = formatPlanName(plan.planId);
          return (
            <Card key={plan.planId}>
              <CardHeader>
                <CardTitle>{name}</CardTitle>
                <div className="text-3xl font-black tracking-[-0.06em]">{formatMonthlyPrice(plan.monthlyPriceUsd)}</div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-muted-foreground">
                <p>{plan.monthlyAutocompleteSuggestions.toLocaleString()} autocompletes per month</p>
                <CardDescription>Personal Memory included</CardDescription>
              </CardContent>
              <CardFooter>
                {plan.planId === "free" ? <span className="text-muted-foreground">Free forever</span> : <Button asChild><a href={`/billing/checkout?plan=${plan.planId}`}>Choose {name}</a></Button>}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "pricing", component: PricingPage });
