import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import type { OperationEntry } from './operations-demo';

export function DemoModal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="process-dialog" onCancel={close} aria-labelledby={id}>
      <span className="eyebrow">UI PREVIEW · NO LIVE ACTION</span>
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
export function Choices({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  change: (value: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="choice-field">
      <legend>{label}</legend>
      <div className="choice-grid">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => change(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function AuditFields({
  actor,
  note,
  setActor,
  setNote,
}: {
  actor: string;
  note: string;
  setActor: (value: string) => void;
  setNote: (value: string) => void;
}) {
  return (
    <>
      <label className="form-field">
        Operator
        <input
          required
          maxLength={80}
          value={actor}
          onChange={(event) => setActor(event.target.value)}
        />
      </label>
      <label className="form-field">
        Reason / note
        <textarea
          required
          maxLength={1500}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
    </>
  );
}
export function demoEntry(
  target: string,
  action: string,
  actor: string,
  note: string,
  workerId?: string,
): OperationEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    target,
    workerId,
    actor: actor.trim(),
    action,
    note: note.trim(),
  };
}
export function fullTime(at: string) {
  return new Date(at)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}
export function Actions({
  close,
  label = 'Save demo changes',
  disabled = false,
}: {
  close: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="dialog-actions">
      <button type="button" className="action-secondary" onClick={close}>
        Cancel
      </button>
      <button type="submit" className="action-primary" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}
