/** Normalize Nigerian mobile input to the national 10-digit subscriber number. */
export function normalizeNigerianPhoneInput(value: string): string {
  let digits = value.replace(/\D/g, "");

  if (digits.startsWith("234")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);

  return digits.slice(0, 10);
}

/** Build an E.164 number only when the input is a complete Nigerian mobile number. */
export function toNigerianE164(value: string): string | null {
  const nationalNumber = normalizeNigerianPhoneInput(value);
  if (!/^\d{10}$/.test(nationalNumber)) return null;
  return `+234${nationalNumber}`;
}
