/** Passkey name, unique per account: Google Password Manager collapses passkeys with the same name into one
 * picker entry, so several accounts all called "Mirror account" could not be told apart on restore. */
export function passkeyLabel(brand: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${brand} account · ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
