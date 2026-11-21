/** A book-desk phone is 10 digits. Extensions are not part of the number. */
export function tenDigitPhone(value: string): string {
  const raw = value.trim();
  if (/[x#]/i.test(raw) || /\bext\b/i.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return "";
}

export function filterDeskCustomers<T extends { id: string; name: string; phone?: string }>(
  customers: T[],
  vehicles: { customerId: string; vin?: string }[],
  query: string,
): T[] {
  const text = query.trim().toLowerCase();
  if (!text) return customers;
  const digits = text.replace(/\D/g, "");
  const vinQuery = text.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return customers.filter((customer) => {
    if (customer.name.toLowerCase().includes(text)) return true;
    if (digits.length >= 3 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
    if (vinQuery.length >= 3) {
      return vehicles.some((vehicle) => vehicle.customerId === customer.id && (vehicle.vin ?? "").toUpperCase().slice(-8).includes(vinQuery));
    }
    return false;
  });
}
