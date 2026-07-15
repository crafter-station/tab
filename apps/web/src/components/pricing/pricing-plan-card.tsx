import { Check } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
} from "@tab/ui";
import type { ReactNode } from "react";

type PricingPlanAction =
  | { kind: "link"; href: string; label: string }
  | { kind: "checkout"; plan: "pro" | "max"; label: string };

export type PricingPlan = {
  name: "Free" | "Pro" | "Max";
  price: string;
  billing: string;
  badge: string;
  description?: string;
  features: ReactNode[];
  action: PricingPlanAction;
  actionNote?: string;
  featured?: boolean;
  id?: string;
};

export function PricingPlanCard({ plan, headingLevel = 3 }: { plan: PricingPlan; headingLevel?: 2 | 3 }) {
  const featureTone = plan.featured ? "text-background/80" : "text-muted-foreground";
  const emphasisTone = plan.featured ? "text-background" : "text-foreground";

  return (
    <article className={cn("h-full", plan.id && "scroll-mt-24")} data-pricing-plan={plan.name.toLowerCase()} id={plan.id}>
      <Card className={cn(
        "flex h-full flex-col shadow-none",
        plan.featured && "border-foreground bg-foreground text-background",
      )}>
        <CardHeader className="p-6 pb-0 sm:p-8 sm:pb-0">
          <div className="flex min-h-7 items-center justify-between gap-3">
            <CardTitle headingLevel={headingLevel} className="text-xl font-bold data-[detail=full]:text-2xl" data-detail={plan.description ? "full" : "summary"}>{plan.name}</CardTitle>
            <Badge
              variant={plan.featured ? "outline" : "secondary"}
              className={cn(
                "shrink-0",
                plan.featured && "border-background/20 bg-transparent text-background/75",
              )}
            >
              {plan.badge}
            </Badge>
          </div>
          {plan.description ? (
            <CardDescription className={cn("mt-1 min-h-12", plan.featured && "text-background/65")}>
              {plan.description}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col p-6 pt-0 sm:p-8 sm:pt-0">
          <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">{plan.price}</p>
          <p className={cn("mt-2 min-h-10 text-sm leading-relaxed", plan.featured ? "text-background/65" : "text-muted-foreground")}>{plan.billing}</p>
          <ul className={cn("mt-7 grid flex-1 gap-3 text-sm leading-relaxed", featureTone)}>
            {plan.features.map((feature, index) => (
              <li className="flex gap-2" key={index}>
                <Check className={cn("mt-1 shrink-0", emphasisTone)} aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="mt-8 block p-6 pt-0 sm:p-8 sm:pt-0">
          {plan.action.kind === "checkout" ? (
            <form action="/billing/checkout" method="get" className="grid gap-3">
              <input type="hidden" name="plan" value={plan.action.plan} />
              <Button className="w-full" variant="secondary" size="lg" type="submit">{plan.action.label}</Button>
            </form>
          ) : (
            <Button asChild className="w-full" variant="secondary" size="lg">
              <a href={plan.action.href}>{plan.action.label}</a>
            </Button>
          )}
          {plan.actionNote ? <p className={cn("mt-3 text-center text-xs", plan.featured ? "text-background/70" : "text-muted-foreground")}>{plan.actionNote}</p> : null}
        </CardFooter>
      </Card>
    </article>
  );
}

export function PricingPlanGrid({ plans, headingLevel = 3, className }: { plans: PricingPlan[]; headingLevel?: 2 | 3; className?: string }) {
  return (
    <div className={cn("grid items-stretch gap-4 lg:grid-cols-3", className)} data-pricing-grid>
      {plans.map((plan) => <PricingPlanCard headingLevel={headingLevel} key={plan.name} plan={plan} />)}
    </div>
  );
}
