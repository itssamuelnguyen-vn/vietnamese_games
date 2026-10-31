import { api } from '../socket';
import type { Strings } from '../i18n';
import { toast } from './Toaster';

export async function startGame(t: Strings): Promise<void> {
  const r = await api.start();
  if (!r.ok) toast(t.errors[r.error]);
}
