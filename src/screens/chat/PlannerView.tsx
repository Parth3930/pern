/**
 * PlannerView.tsx
 * Compact live status strip shown while a multi-step task plan executes.
 * No buttons — plan runs automatically.
 *
 * ponytail: inline styles, no deps.
 */

import { TaskPlan } from "./taskPlanner";

const STATUS_ICON: Record<string, string> = {
  pending: "·",
  running: "◌",
  done: "✓",
  error: "✗",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-secondary)",
  running: "var(--accent)",
  done: "#4ade80",
  error: "#f87171",
};

const CAT_EMOJI: Record<string, string> = {
  generation: "✍️",
  notes: "📝",
  whatsapp: "💬",
  discord: "🎮",
  email: "📧",
  apps: "🖥️",
  system: "⚙️",
};

export function PlannerView({ plan }: { plan: TaskPlan }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "8px 12px",
        margin: "6px 0",
        background: "rgba(255,255,255,0.03)",
        borderLeft: "2px solid var(--accent)",
        borderRadius: "4px",
        animation: "slideUp 0.15s ease",
      }}
    >
      {plan.steps.map((step) => (
        <div
          key={step.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.78rem",
            color: step.status === "pending" ? "var(--text-secondary)" : "var(--text-primary, #fff)",
            opacity: step.status === "pending" ? 0.5 : 1,
            transition: "opacity 0.2s, color 0.2s",
          }}
        >
          <span style={{ fontSize: "0.7rem" }}>{CAT_EMOJI[step.category] ?? "•"}</span>
          <span style={{ flex: 1 }}>{step.label}</span>
          <span
            style={{
              color: STATUS_COLOR[step.status],
              fontWeight: 700,
              fontSize: "0.72rem",
              animation: step.status === "running" ? "pulse 0.8s ease infinite" : "none",
            }}
          >
            {STATUS_ICON[step.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
