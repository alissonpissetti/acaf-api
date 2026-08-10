import type { ConnectPlanId, UnitPlanSpec } from './types';
import { getDomain } from './store';

export type ConnectDomainPlan = {
  id: string;
  name: string;
  pricePerMonth: number;
  tierIndex: number;
  description?: string;
};

export function getConnectPlansFromDomain(): ConnectDomainPlan[] {
  const domain = getDomain() as { connectPlans?: ConnectDomainPlan[] };
  const plans = domain.connectPlans ?? [];
  return [...plans].sort((a, b) => (a.tierIndex ?? 0) - (b.tierIndex ?? 0));
}

export function defaultPlanSpecsFromDomain(): UnitPlanSpec[] {
  return getConnectPlansFromDomain().map((plan, index) => ({
    connectPlanId: plan.id as ConnectPlanId,
    enabled: index <= 2,
    includedModalities: [],
    exactOnly: false,
  }));
}

export function mergePlanSpecsWithDomain(saved: UnitPlanSpec[] | undefined): UnitPlanSpec[] {
  const plans = getConnectPlansFromDomain();
  return plans.map((plan, index) => {
    const found = saved?.find((spec) => spec.connectPlanId === plan.id);
    return (
      found ?? {
        connectPlanId: plan.id as ConnectPlanId,
        enabled: index <= 2,
        includedModalities: [],
        exactOnly: false,
      }
    );
  });
}
