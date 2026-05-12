/**
 * Time window utilities for enforcing calling hours
 */

import { env } from '../config/env';

interface TimeWindow {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

/**
 * Parse "HH:mm" string to minutes since midnight
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Get current time in minutes since midnight for a given timezone
 */
function getCurrentMinutes(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const hours = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minutes = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

  return hours * 60 + minutes;
}

/**
 * Check if current time falls within allowed calling hours for a customer
 * @param customerTimezone Customer's timezone (e.g., "Asia/Kolkata")
 * @param preferredStart Customer's preferred call start time (HH:mm)
 * @param preferredEnd Customer's preferred call end time (HH:mm)
 * @returns true if it's okay to call now
 */
export function isWithinCallingHours(
  customerTimezone: string = 'Asia/Kolkata',
  preferredStart?: string | null,
  preferredEnd?: string | null
): boolean {
  const currentMinutes = getCurrentMinutes(customerTimezone);

  // First check global calling hours (9am-8pm compliance requirement)
  const globalStart = parseTimeToMinutes(env.CALLING_HOURS_START);
  const globalEnd = parseTimeToMinutes(env.CALLING_HOURS_END);

  if (currentMinutes < globalStart || currentMinutes > globalEnd) {
    return false;
  }

  // Then check customer-specific preferred window if set
  if (preferredStart && preferredEnd) {
    const custStart = parseTimeToMinutes(preferredStart);
    const custEnd = parseTimeToMinutes(preferredEnd);

    if (currentMinutes < custStart || currentMinutes > custEnd) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate next available calling time for a customer
 */
export function getNextCallingWindow(
  customerTimezone: string = 'Asia/Kolkata',
  preferredStart?: string | null
): Date {
  const now = new Date();
  const startTime = preferredStart ?? env.CALLING_HOURS_START;
  const [hours, minutes] = startTime.split(':').map(Number);

  // Create a date for the next available window
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  // If we've already passed this time today, schedule for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}
