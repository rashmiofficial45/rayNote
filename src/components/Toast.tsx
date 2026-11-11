import React from "react";

export interface ToastData {
  id: number;
  message: string;
  icon?: React.ReactNode;
}

interface ToastProps {
  toast: ToastData | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;

  return (
    <div key={toast.id} className="notefast-toast flex items-center gap-[8px] text-[12px] [font-weight:500] text-[color:var(--text-primary)] whitespace-nowrap">
      {toast.icon && <span className="notefast-toast-icon inline-flex items-center justify-center text-[color:var(--color-accent)]">{toast.icon}</span>}
      <span className="notefast-toast-message [line-height:1]">{toast.message}</span>
    </div>
  );
}
