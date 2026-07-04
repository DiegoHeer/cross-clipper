import type { DeviceView } from "../../shared/model";
import { platformIcon } from "../../shared/model";

export interface DeviceRailProps {
  devices: DeviceView[];
  selected: string | null;
  onSelect(id: string | null): void;
}

/** Extension spec §3: "All" + one button per device (icon, short name, presence dot).
 *  selected === null ⇒ All. Rail is a view filter, never an address book. */
export function DeviceRail({ devices, selected, onSelect }: DeviceRailProps) {
  return (
    <nav
      className="rail"
      aria-label="Devices"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-2)",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <button
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
        style={{
          background: selected === null ? "var(--accent-soft)" : "transparent",
          border: "none",
          borderRadius: "var(--radius-sm)",
          padding: "var(--space-1) var(--space-2)",
          cursor: "pointer",
          color: "var(--text)",
          fontWeight: selected === null ? 600 : 400,
        }}
      >
        All
      </button>
      {devices.map((d) => (
        <button
          key={d.id}
          aria-pressed={selected === d.id}
          onClick={() => onSelect(d.id)}
          title={d.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            background: selected === d.id ? "var(--accent-soft)" : "transparent",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-1) var(--space-2)",
            cursor: "pointer",
            color: "var(--text)",
            fontWeight: selected === d.id ? 600 : 400,
            textAlign: "left",
          }}
        >
          <span aria-hidden>{platformIcon(d.platform)}</span>
          <span className="rail-name">{d.name}</span>
          <span
            className={d.online ? "dot dot-online" : "dot dot-offline"}
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: d.online ? "var(--success)" : "var(--text-muted)",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          />
        </button>
      ))}
    </nav>
  );
}
