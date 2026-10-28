/** Advisor-facing No-show flag for a customer record. */
export function NoShowMark({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="text-sm font-semibold text-[#8a3b2a]">No-show{count > 1 ? ` · ${count}` : ""}</span>;
}

export function noShowSuffix(count: number) {
  return count > 0 ? " · No-show" : "";
}
