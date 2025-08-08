// StrategyConfigLoader.jsx
import React from "react";

import ScalperConfig       from "./ScalperConfig";
import BreakoutConfig      from "./BreakoutConfig";
import ChadModeConfig      from "./ChadModeConfig";
import DelayedSniperConfig from "./DelayedSniperConfig";
import DipBuyerConfig      from "./DipBuyerConfig";
import RebalancerConfig    from "./RebalancerConfig";
import RotationBotConfig   from "./RotationBotConfig";
import TargetWeightsBuilder from "./TargetWeightsBuilder";
import TrendFollowerConfig from "./TrendFollowerConfig";
import PaperTraderConfig   from "./PaperTraderConfig";
import SniperConfig        from "./SniperConfig";
import StealthBotConfig from "./StealthBotConfig";
import TurboSniperConfig from "./TurboSniperConfig";
import LimitEntryBlock  from "./LimitEntryBlock";
import AdvancedSection  from "../ui/AdvancedSection";
import AdvancedFields from "../ui/AdvancedFields";
/* ------------------------------------------------------------------ */
/* Helper → when should we expose the Entry-Conditions block?         */
/* ------------------------------------------------------------------ */
const shouldShowEntry = (config = {}) => {
  return config.useTargetToken && !!config.tokenMint;
};

/* ------------------------------------------------------------------ */

export default function StrategyConfigLoader({
  strategy,
  config       = {},
  setConfig,
  disabled,
  walletTokens,
}) {
const entryBlock = shouldShowEntry(config) && (
  <AdvancedSection title="Entry Conditions">
    <LimitEntryBlock
      state={config}
      setState={setConfig}
      disabled={disabled}
    />
  </AdvancedSection>
);

  switch (strategy) {
    /* ─────────────────────────── scalper ─ */
    case "scalper":
      return (
        <ScalperConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock}
        </ScalperConfig>
      );

    /* ───────────────────────── breakout ─ */
    case "breakout":
      return (
        <BreakoutConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock}
        </BreakoutConfig>
      );

    /* ───────────────────────── chadMode ─ */
    case "chadMode":
      return (
        <ChadModeConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        />
      );

    /* ───────────────────── delayedSniper ─ */
    case "delayedSniper":
      return (
        <DelayedSniperConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock}
        </DelayedSniperConfig>
      );

    /* ───────────────────────── dipBuyer ─ */
    case "dipBuyer":
      return (
        <DipBuyerConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock}
        </DipBuyerConfig>
      );

      /* ─────────────────────── rebalancer ─ */
case "rebalancer":
  console.log("📦 StrategyConfigLoader walletTokens → Rebalancer:", walletTokens);
  return (
    <RebalancerConfig
      config={config}
      setConfig={setConfig}
      disabled={disabled}
      walletTokens={walletTokens}
      customFields={[
        { label: "Max Slippage (%)", name: "maxSlippage", placeholder: "e.g. 0.5" },
        { label: "Priority Fee (lamports)", name: "priorityFeeLamports", placeholder: "e.g. 20000" },
        { label: "Halt on Fails (#)", name: "haltOnFailures", placeholder: "e.g. 5" },
      ]}
    />
  );

      /* ─────────────────────── rotationBot ─ */
case "rotationBot":
  return (
    <RotationBotConfig
      config={config}
      setConfig={setConfig}
      disabled={disabled}
      customFields={[
        { label: "Max Slippage (%)", name: "maxSlippage", placeholder: "e.g. 0.5" },
        { label: "Priority Fee (lamports)", name: "priorityFeeLamports", placeholder: "e.g. 20000" },
        { label: "Halt on Fails (#)", name: "haltOnFailures", placeholder: "e.g. 5" },

      ]}
    />
  );

    /* ─────────────────────── paperTrader ─ */
    case "paperTrader":
      return (
        <PaperTraderConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock}
        </PaperTraderConfig>
      );

    /* ───────────────────────── sniper ─ */
    case "sniper": {
      /* ensure sensible defaults even on a blank profile */
      const defaultSniperCfg = {
        entryThreshold : 3,
        volumeThreshold: 50_000,
        priceWindow    : "1h",
        volumeWindow   : "24h",
        ...config,
      };

      return (
        <SniperConfig
          config={defaultSniperCfg}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock /* always true for Sniper */}
        </SniperConfig>
      );
    }

    /* ─────────────────── targetWeights builder ─ */
    case "targetWeights":
      return (
        <TargetWeightsBuilder
          walletTokens={walletTokens}
          targetWeights={config.targetWeights}
          setTargetWeights={(val) =>
            setConfig((prev) => ({ ...prev, targetWeights: val }))
          }
        />
      );

    /* ───────────────────── trendFollower ─ */
    case "trendFollower":
      return (
        <TrendFollowerConfig
          config={config}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock}
        </TrendFollowerConfig>
      );

    /* ───────────────────── turboSniper ─ */
    case "turboSniper": {
      const defaultTurboCfg = {
        entryThreshold : 3,
        volumeThreshold: 50_000,
        priceWindow    : "1h",
        volumeWindow   : "24h",
        ...config,
      };
      return (
        <TurboSniperConfig
          config={defaultTurboCfg}
          setConfig={setConfig}
          disabled={disabled}
        >
          {entryBlock /* always true for TurboSniper */}
        </TurboSniperConfig>
      );
    }

      case "stealthBot":
  return (
    <StealthBotConfig
      config={config}
      setConfig={setConfig}
      disabled={disabled}
      customFields={[
        { label: "Max Slippage (%)", name: "maxSlippage", placeholder: "e.g. 0.5" },
        { label: "Priority Fee (lamports)", name: "priorityFeeLamports", placeholder: "e.g. 20000" },
        { label: "Halt on Fails (#)", name: "haltOnFailures", placeholder: "e.g. 5" },
        {label:"Size Jitter %",  name:"sizeJitterPct"},
        {label:"Delay Min (ms)", name:"delayMinMs"},
        {label:"Delay Max (ms)", name:"delayMaxMs"},
        {label:"Skip if already holding", name:"skipIfHolding", type:"checkbox"},
      ]}
    />
  );

    /* ─────────────────────── default ─ */
    default:
      return null;
  }
}
