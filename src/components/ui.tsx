import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({
  children,
  tone = "ghost",
  small,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "accent"; small?: boolean }) {
  return (
    <button type={type} className={cn("btn", tone === "primary" && "btn-primary", tone === "ghost" && "btn-ghost", tone === "accent" && "btn-accent", small && "btn-small", className)} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="label">
      {label}
      {children}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={cn("modal-panel", wide && "modal-wide")}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-3xl leading-none tracking-tight">{title}</Dialog.Title>
              <Dialog.Description className={description ? "mt-1 text-sm text-muted" : "sr-only"}>
                {description ?? title}
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-ghost btn-small">Close</Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Meter({ value, max, bad }: { value: number; max: number; bad?: boolean }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("meter", bad && "bad")} aria-hidden>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone?: "bad" | "good" }) {
  return <span className={cn("pill", tone === "bad" && "pill-bad", tone === "good" && "pill-good")}>{children}</span>;
}
