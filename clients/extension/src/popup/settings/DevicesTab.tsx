import { useState } from "react";
import { relativeTime } from "../format";
import { parseUtc, platformIcon, type DeviceView } from "../../shared/model";
import type { WorkerApi } from "../useWorker";

export const STALE_AFTER_DAYS = 14;

export function isStale(lastSeenAt: string, now: Date = new Date()): boolean {
  return now.getTime() - parseUtc(lastSeenAt).getTime() > STALE_AFTER_DAYS * 86_400_000;
}

export function DevicesTab({ devices, api }: { devices: DeviceView[]; api: WorkerApi }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <ul className="device-list">
      {devices.map((d) => (
        <li key={d.id} className="device-row">
          <span aria-hidden>{platformIcon(d.platform)}</span>
          <div className="device-main">
            {renaming === d.id ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    void api.renameDevice(d.id, name.trim());
                    setRenaming(null);
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span>
                {d.name} {d.isSelf && <em className="badge">this device</em>}
                {isStale(d.lastSeenAt) && <em className="nudge">Revoke?</em>}
              </span>
            )}
            <span className="text-muted presence">
              {d.online ? "online now" : `last seen ${relativeTime(d.lastSeenAt)}`}
            </span>
          </div>
          <button
            aria-label="Rename"
            onClick={() => {
              setRenaming(d.id);
              setName(d.name);
            }}
          >
            ✎
          </button>
          {!d.isSelf &&
            (confirming === d.id ? (
              <button className="danger" onClick={() => void api.revokeDevice(d.id)}>
                Revoke?
              </button>
            ) : (
              <button aria-label="Revoke" className="danger" onClick={() => setConfirming(d.id)}>
                ⊘
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
}
