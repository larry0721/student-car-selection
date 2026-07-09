import type { BudgetSummary, BuyerProfile } from "@/types/buyer";

export function calculateBudget(profile: BuyerProfile): BudgetSummary {
  const fuelCost = profile.minMpg
    ? (profile.expectedAnnualMileage / 12 / profile.minMpg) * profile.fuelPrice
    : 0;
  const maintenanceReserve = Math.max(75, profile.monthlyBudget * 0.1);
  const paymentBudget = Math.max(
    0,
    profile.monthlyBudget - profile.insuranceBudget - fuelCost - maintenanceReserve,
  );
  const principal = getLoanPrincipal(paymentBudget, profile.apr, profile.loanTermMonths);
  const maxPurchasePrice = Math.max(0, (principal + profile.downPayment) / 1.08);

  return {
    fuelCost: Math.round(fuelCost),
    maintenanceReserve: Math.round(maintenanceReserve),
    paymentBudget: Math.round(paymentBudget),
    maxPurchasePrice: Math.round(maxPurchasePrice),
  };
}

function getLoanPrincipal(monthlyPayment: number, apr: number, months: number) {
  if (!monthlyPayment || !months) return 0;
  const monthlyRate = apr / 100 / 12;
  if (!monthlyRate) return monthlyPayment * months;
  return monthlyPayment * ((1 - (1 + monthlyRate) ** -months) / monthlyRate);
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
