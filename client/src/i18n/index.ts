import type { ErrorCode } from '@vg/shared';
import { vi, type Strings } from './vi';

export const t: Strings = vi;

export function errorText(code: ErrorCode): string {
  return t.errors[code] ?? code;
}
