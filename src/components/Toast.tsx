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
    <div key={toast.id} className="notefast-toast">
      {toast.icon && <span className="notefast-toast-icon">{toast.icon}</span>}
      <span className="notefast-toast-message">{toast.message}</span>
    </div>
  );
}
