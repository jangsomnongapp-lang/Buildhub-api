// Copied from biz-link-droid/src/lib/auth.tsx and src/lib/password.ts.
// These MUST stay identical to the web app, or existing users can't log in.

/** Normalize a Cambodian phone number to its local digits without +855 or a trunk zero. */
export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").replace(/^855/, "").replace(/^0+/, "");
}

/** Accounts are stored with a synthetic email built from the phone number. */
export function phoneToEmail(phone: string) {
  return `p${normalizePhone(phone)}@project001.local`;
}

/** Include historical account formats created before phone normalization was standardized. */
export function phoneLoginEmails(phone: string) {
  const rawDigits = phone.replace(/\D/g, "");
  const localDigits = normalizePhone(phone);
  return Array.from(
    new Set([
      `p${localDigits}@project001.local`,
      `p0${localDigits}@project001.local`,
      `p${rawDigits}@project001.local`,
    ]),
  );
}

/** "+855" plus local digits, as stored in raw_user_meta_data.phone. */
export function phoneE164(phone: string) {
  return `+855${normalizePhone(phone)}`;
}

/** Passwords shorter than 6 characters get a fixed suffix (the old auth backend required 6). */
const PAD = "Bh1!x9";
export function normalizePassword(pw: string): string {
  if (!pw) return pw;
  return pw.length >= 6 ? pw : pw + PAD;
}
