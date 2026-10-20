import type { PayKind, PayTypeDef } from "./types";

export const KIND_LABEL: Record<PayKind, string> = {
  customer: "Customer",
  warranty: "Warranty",
  internal: "Internal",
};

export function defaultPayTypes(rates?: { cpRate?: number; warrantyRate?: number; internalRate?: number }): PayTypeDef[] {
  return [
    { id: "cp", name: "Customer", rate: rates?.cpRate ?? 189, kind: "customer" },
    { id: "warranty", name: "Warranty", rate: rates?.warrantyRate ?? 168, kind: "warranty" },
    { id: "internal", name: "Internal", rate: rates?.internalRate ?? 140, kind: "internal" },
  ];
}

export function payById(payTypes: PayTypeDef[] | undefined, id: string) {
  return payTypes?.find((row) => row.id === id);
}

export function payLabel(payTypes: PayTypeDef[] | undefined, id: string) {
  return payById(payTypes, id)?.name ?? id;
}

export function payKindOf(payTypes: PayTypeDef[] | undefined, id: string): PayKind {
  const row = payById(payTypes, id);
  if (row) return row.kind;
  if (id === "warranty") return "warranty";
  if (id === "internal") return "internal";
  return "customer";
}

export function rateFor(id: string, payTypes: PayTypeDef[] | undefined) {
  return payById(payTypes, id)?.rate ?? 0;
}

export function doorRate(payTypes: PayTypeDef[] | undefined) {
  const primary = payTypes?.find((row) => row.id === "cp") ?? payTypes?.find((row) => row.kind === "customer");
  return primary?.rate ?? 0;
}

export function partSell(cost: number, list: number, kind: PayKind) {
  if (kind === "customer") return list;
  if (kind === "warranty") return Math.round(cost * 135) / 100;
  return Math.round(cost * 112) / 100;
}
