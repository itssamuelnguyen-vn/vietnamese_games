import { api } from '../socket';
import { errorText } from '../i18n';
import { toast } from './Toaster';

export async function startGame(): Promise<void> {
  const r = await api.start();
  if (!r.ok) toast(errorText(r.error));
}
