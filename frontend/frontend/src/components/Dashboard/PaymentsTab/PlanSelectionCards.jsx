import React from "react";

export default function PlanSelectionCards({ currentPlan, onSelect }) {
  const plans = [
    { name: "Standard", price: "$20/month", quota: "600K CU", key: "standard" },
    { name: "Pro", price: "$50/month", quota: "1.5M CU", key: "pro" },
  ];

  return (
    <div className="bg-zinc-800 p-4 rounded-lg">
      <h3 className="text-lg font-semibold">
        {currentPlan === "free" ? "Upgrade Subscription" : "Change Subscription"}
      </h3>
      <p className="text-sm">
        Your current subscription:{" "}
        <span className="text-emerald-400 capitalize">{currentPlan} Plan</span>
      </p>

      <div className="mt-4 flex gap-4 flex-wrap">
        {plans.map((plan) => (
         <div
  key={plan.key}
  onClick={() => onSelect(plan.key)}
  className={`cursor-pointer rounded-lg p-4 w-full max-w-xs transition
    ${
      currentPlan === plan.key
        ? "border-2 border-emerald-500 bg-zinc-800"
        : "border border-zinc-700 bg-zinc-900 hover:border-emerald-300"
    }`}
>
  <h4 className="text-lg font-bold text-white">{plan.name} Plan</h4>
  <p className="text-sm text-white-400">{plan.price}</p>
  <p className="mt-2 text-xs text-white-500">{plan.quota}</p>

  {currentPlan === plan.key && (
    <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-emerald-500 text-black rounded-full">
      Current
    </span>
  )}
</div>
        ))}
      </div>
    </div>
  );
}
