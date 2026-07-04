export interface BannerProps {
  kind: "reconnecting" | "version";
  message?: string;
}

export function Banner({ kind, message }: BannerProps) {
  return (
    <div className={`banner banner-${kind}`} role="status">
      {kind === "reconnecting" ? "Reconnecting…" : message}
    </div>
  );
}
