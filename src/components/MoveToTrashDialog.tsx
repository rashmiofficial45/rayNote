import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";

interface TrashConfirmationProps {
  title: string;
  permanent?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function TrashConfirmation({ title, permanent = false, busy = false, onCancel, onConfirm }: TrashConfirmationProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const label = permanent ? "Delete Permanently" : "Move to Trash";

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <>
      <header className="trash-header">
        <h2 id="trash-confirm-title"><Trash2 size={19} aria-hidden="true" />{label}</h2>
      </header>
      <div className="trash-confirmation">
        <p id="trash-confirm-description">
          {permanent
            ? <>Permanently delete <strong>{title}</strong>? This can’t be undone.</>
            : <>Move <strong>{title}</strong> to Trash? You can restore it later.</>}
        </p>
        <div className="trash-actions">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" disabled={busy}
            className={`trash-destructive${permanent ? "" : " move-trash-confirm"}`}
            onClick={onConfirm}>{label}</button>
        </div>
      </div>
    </>
  );
}

export function MoveToTrashDialog(props: TrashConfirmationProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal?.();
    dialog?.querySelector("button")?.focus();
    return () => dialog?.close?.();
  }, []);

  return (
    <dialog ref={dialogRef} className="trash-dialog move-trash-dialog" role="alertdialog"
      aria-labelledby="trash-confirm-title" aria-describedby="trash-confirm-description"
      onCancel={(event) => { event.preventDefault(); props.onCancel(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onCancel();
        }
      }}>
      <TrashConfirmation {...props} />
    </dialog>
  );
}
