import { useEffect, useRef, useState } from "react";
import { FeedCard, type FeedEntry } from "./FeedCard";

export interface FeedProps {
  entries: FeedEntry[];
  selfDeviceId: string | null;
  nameOf(id: string): string;
  iconOf(id: string): string;
  onCopy(body: string): void | Promise<void>;
  onOpen(url: string): void;
  onDelete(id: string): void;
  onRetry(id: string): void;
}

export function Feed({ entries, selfDeviceId, nameOf, iconOf, onCopy, onOpen, onDelete, onRetry }: FeedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const prevTopId = useRef<string | null>(null);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    const topEntry = entries[0];
    const topId = topEntry?.item.id ?? null;
    if (
      prevTopId.current !== null &&
      topId !== null &&
      topId !== prevTopId.current &&
      scrolled.current
    ) {
      // Own sends (optimistic outbox echoes or items from this device) must not
      // count toward the pill — the pill exists to flag arrivals from OTHER devices.
      const isSelfSend =
        topEntry?.sendState === "pending" ||
        (selfDeviceId !== null && topEntry?.item.origin_device_id === selfDeviceId);
      if (!isSelfSend) {
        setNewCount((n) => n + 1);
      }
    }
    prevTopId.current = topId;
  }, [entries, selfDeviceId]);

  const onScroll = () => {
    scrolled.current = (ref.current?.scrollTop ?? 0) > 40;
    if (!scrolled.current) setNewCount(0);
  };

  return (
    <div className="feed" ref={ref} onScroll={onScroll}>
      {newCount > 0 && (
        <button
          className="pill"
          aria-label={`${newCount} new item${newCount > 1 ? "s" : ""}`}
          onClick={() => {
            ref.current?.scrollTo({ top: 0 });
            setNewCount(0);
          }}
        >
          ↑ {newCount} new item{newCount > 1 ? "s" : ""}
        </button>
      )}
      {entries.length === 0 && (
        <p className="empty">Copy something on another device, or type below.</p>
      )}
      {entries.map((entry) => (
        <FeedCard
          key={entry.item.id}
          entry={entry}
          originName={nameOf(entry.item.origin_device_id)}
          originIcon={iconOf(entry.item.origin_device_id)}
          onCopy={onCopy}
          onOpen={onOpen}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}
