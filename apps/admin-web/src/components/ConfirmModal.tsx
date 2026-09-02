import { Icon } from './Icons';

interface ConfirmModalProps {
  title: string;
  body: React.ReactNode;
  what?: string;
  danger?: boolean;
  confirmLabel?: string;
  /** Blocks the confirm action — e.g. while a pre-confirm impact preview is
   *  still loading or failed to load, so the admin can't confirm blind. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  title,
  body,
  what,
  danger,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <Icon.Close />
          </button>
        </div>
        <div className="modal-body">
          <p>{body}</p>
          {what && <div className="what">{what}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
