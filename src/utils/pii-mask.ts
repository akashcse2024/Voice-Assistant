/**
 * PII Masking utility — masks sensitive customer data in logs
 * Phone: +91 98765 43210 → +91 987** ***10
 * Name: Rahul Sharma → R***l S****a
 */

/**
 * Mask a phone number, keeping first 6 and last 2 digits visible
 */
export function maskPhone(phone: string): string {
  if (!phone) return '***';
  const cleaned = phone.replace(/\s/g, '');
  if (cleaned.length <= 4) return '****';

  // Keep country code + first 3 digits and last 2
  const prefix = cleaned.slice(0, Math.min(6, cleaned.length - 2));
  const suffix = cleaned.slice(-2);
  const maskedMiddle = '*'.repeat(Math.max(cleaned.length - prefix.length - suffix.length, 2));

  return `${prefix}${maskedMiddle}${suffix}`;
}

/**
 * Mask a person's name, keeping first and last characters of each word
 */
export function maskName(name: string): string {
  if (!name) return '***';
  return name
    .split(' ')
    .map((word) => {
      if (word.length <= 2) return '*'.repeat(word.length);
      return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1];
    })
    .join(' ');
}

/**
 * Mask an email address
 */
export function maskEmail(email: string): string {
  if (!email) return '***';
  const [local, domain] = email.split('@');
  if (!domain) return '***@***';
  const maskedLocal =
    local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
  return `${maskedLocal}@${domain}`;
}

/**
 * Mask PII fields in an object for safe logging
 */
export function maskPII(data: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...data };

  if (typeof masked.phone === 'string') masked.phone = maskPhone(masked.phone);
  if (typeof masked.customerPhone === 'string')
    masked.customerPhone = maskPhone(masked.customerPhone);
  if (typeof masked.name === 'string') masked.name = maskName(masked.name);
  if (typeof masked.customerName === 'string')
    masked.customerName = maskName(masked.customerName);
  if (typeof masked.email === 'string') masked.email = maskEmail(masked.email);

  return masked;
}
