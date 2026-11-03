import { type FormEvent, useRef, useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import {
  cancelQueuedJob,
  jobActionErrorMessage,
  jobActionFor,
  jobActionNotice,
  retryFailedJob,
} from './live-job-actions';

/** Cancel (queued) or retry (failed) one job, with an audited reason. Shown in the job drawer. */
export function LiveJobActions({
  baseUrl,
  token,
  jobId,
  status,
  onDone,
}: {
  baseUrl: string;
  token: string;
  jobId: string;
  status: string;
  onDone: () => void;
}) {
  const kind = jobActionFor(status);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  if (!kind && !notice) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!kind) return;
    const why = reason.trim();
    if (why.length < 3 || why.length > 300)
      return setProblem('Give a reason of 3 to 300 characters.');
    setBusy(true);
    setProblem(null);
    try {
      const result = await (kind === 'cancel' ? cancelQueuedJob : retryFailedJob)(
        baseUrl,
        token,
        jobId,
        why,
      );
      setNotice(jobActionNotice(kind, result));
      setOpen(false);
      setReason('');
      onDone();
    } catch (cause) {
      setProblem(jobActionErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="job-actions">
      <div role="status" className="process-feedback">
        {notice}
      </div>
      {kind && (
        <button
          type="button"
          className="action-secondary"
          onClick={(e) => {
            returnFocus.current = e.currentTarget;
            setProblem(null);
            setOpen(true);
          }}
        >
          {kind === 'cancel' ? 'Cancel this job' : 'Retry this job'}
        </button>
      )}
      {open && kind && (
        <AccessibleDialog
          title={kind === 'cancel' ? 'Cancel queued job' : 'Retry failed job'}
          onClose={() => setOpen(false)}
          returnFocusRef={returnFocus}
        >
          <form onSubmit={submit}>
            <p className="notice">
              {kind === 'cancel'
                ? 'Removes the job from the queue and returns the customer’s credits. Only jobs that have not started can be cancelled; nothing running on a GPU is interrupted.'
                : 'Puts the job back on its queue to run again from the start. If the failure was already refunded, the retry does not charge again.'}
            </p>
            <label className="form-field">
              Reason (audited)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={3}
              />
            </label>
            {problem && (
              <div className="permission-panel" role="alert">
                {problem}
              </div>
            )}
            <div className="process-actions">
              <button type="button" className="action-secondary" onClick={() => setOpen(false)}>
                Back
              </button>
              <button type="submit" className="button-primary" disabled={busy}>
                {kind === 'cancel' ? 'Cancel job' : 'Retry job'}
              </button>
            </div>
          </form>
        </AccessibleDialog>
      )}
    </div>
  );
}
