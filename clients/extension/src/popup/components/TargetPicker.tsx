import type { DeviceView } from "../../shared/model";
import { platformIcon } from "../../shared/model";

export interface TargetPickerProps {
  devices: DeviceView[];
  target: string | null;
  onChange(id: string | null): void;
}

/** System spec §4 notification policy: chips defaulting to Silent.
 *  Targeting controls which device gets ALERTED — never item visibility.
 *  Plan decision 7: excludes the current device (isSelf), resets to Silent after each send. */
export function TargetPicker({ devices, target, onChange }: TargetPickerProps) {
  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-1)",
    background: active ? "var(--accent)" : "var(--surface-raised)",
    color: active ? "var(--accent-fg)" : "var(--text)",
    border: active ? "none" : "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--space-1) var(--space-2)",
    cursor: "pointer",
    fontSize: "0.85em",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div
      className="chips"
      role="group"
      aria-label="Notify device"
      style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginBottom: "var(--space-2)" }}
    >
      <button
        className="chip"
        aria-pressed={target === null}
        onClick={() => onChange(null)}
        style={chipStyle(target === null)}
      >
        Silent
      </button>
      {devices
        .filter((d) => !d.isSelf)
        .map((d) => (
          <button
            key={d.id}
            className="chip"
            aria-pressed={target === d.id}
            onClick={() => onChange(d.id)}
            style={chipStyle(target === d.id)}
          >
            <span aria-hidden>{platformIcon(d.platform)}</span> {d.name}
          </button>
        ))}
    </div>
  );
}
