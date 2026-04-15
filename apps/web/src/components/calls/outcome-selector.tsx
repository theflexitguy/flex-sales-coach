"use client";

import { useState } from "react";
import { CALL_OUTCOMES } from "@flex/shared";
import { useRouter } from "next/navigation";

interface OutcomeSelectorProps {
  callId: string;
  currentOutcome: string | null;
}

export function OutcomeSelector({ callId, currentOutcome }: OutcomeSelectorProps) {
  const [outcome, setOutcome] = useState(currentOutcome ?? "pending");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSelect(value: string) {
    if (value === outcome) return;
    setSaving(true);
    setOutcome(value);

    await fetch(`/api/calls/${callId}/outcome`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: value }),
    });

    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CALL_OUTCOMES.map((o) => (
        <button
          key={o.value}
          onClick={() => handleSelect(o.value)}
          disabled={saving}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors border ${
            outcome === o.value
              ? "border-current"
              : "border-zinc-800 hover:border-zinc-700"
          }`}
          style={{
            color: outcome === o.value ? o.color : "#71717a",
            backgroundColor: outcome === o.value ? `${o.color}15` : "transparent",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
