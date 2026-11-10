import { useEffect, useRef } from "react";

function ConfirmDialog({ title, message, confirmLabel = "Confirm", busy = false, onConfirm, onCancel, tone = "primary" }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Tab") {
        const controls = [cancelRef.current, confirmRef.current].filter((control) => control && !control.disabled);
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      requestAnimationFrame(() => {
        if (openerRef.current?.isConnected) openerRef.current.focus();
        else document.getElementById("student-management-section")?.focus();
      });
    };
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div className="modal-header"><div><h2 id="confirm-dialog-title">{title}</h2><p id="confirm-dialog-message">{message}</p></div></div>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="cancel-button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="button" className={tone === "danger" ? "danger-button" : "primary-button"} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmDialog;
