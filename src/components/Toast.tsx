import { useEffect, useRef, type ReactNode } from "react";

export interface ToastData {
  id: number;
  message: string;
  icon?: ReactNode;
}

interface ToastProps {
  toast: ToastData | null;
  aboveModal?: boolean;
}

export function Toast({ toast, aboveModal = false }: ToastProps) {
  const toastRef = useRef<HTMLDivElement>(null);
  const toastId = toast?.id;

  useEffect(() => {
    const element = toastRef.current;
    if (toastId === undefined || !aboveModal || !element?.showPopover) return;
    // Present after the modal enters the top layer, including when both mount together.
    const frame = requestAnimationFrame(() => element.showPopover());
    return () => cancelAnimationFrame(frame);
  }, [toastId, aboveModal]);

  if (!toast) return null;

  return (
    <div ref={toastRef} key={toast.id} role="status" popover={aboveModal ? "manual" : undefined} className="notefast-toast flex items-center gap-[8px] text-[12px] [font-weight:500] text-[color:var(--text-primary)] whitespace-nowrap">
      {toast.icon && <span className="notefast-toast-icon inline-flex items-center justify-center text-[color:var(--color-accent)]">{toast.icon}</span>}
      <span className="notefast-toast-message [line-height:1]">{toast.message}</span>
    </div>
  );
}
