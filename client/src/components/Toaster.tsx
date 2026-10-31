import { useEffect, useState } from 'react';

interface Toast {
  id: number;
  message: string;
}

type Listener = (toast: Toast) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function toast(message: string): void {
  const t = { id: nextId++, message };
  for (const l of listeners) l(t);
}

const TOAST_MS = 3500;

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast: Listener = (t) => {
      setToasts((list) => [...list.slice(-2), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), TOAST_MS);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
