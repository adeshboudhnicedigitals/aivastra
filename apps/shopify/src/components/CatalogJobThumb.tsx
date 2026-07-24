import { BRAND } from '../theme';
import type { CatalogGenerateJob } from '../types';
import { SpinnerIcon } from './icons';

export function CatalogJobThumb({
  job,
  onPublish,
}: {
  job: CatalogGenerateJob;
  onPublish: (jobId: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        style={{
          width: '100%',
          aspectRatio: '3 / 4',
          borderRadius: '12px',
          overflow: 'hidden',
          background: job.status === 'FAILED' ? BRAND.dangerBg : '#F1F0F5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {job.status === 'COMPLETED' && job.resultUrl ? (
          // biome-ignore lint/performance/noImgElement: dynamic remote thumbnail
          <img
            src={job.resultUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : job.status === 'FAILED' ? (
          <div
            style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 600,
              color: BRAND.dangerStrong,
            }}
          >
            Generation failed{job.errorCode ? ` (${job.errorCode})` : ''}
          </div>
        ) : (
          <SpinnerIcon size={22} color={BRAND.purple} />
        )}
      </div>
      {job.status === 'COMPLETED' && (
        <button
          type="button"
          disabled={job.published}
          onClick={() => onPublish(job.jobId)}
          style={{
            height: '34px',
            border: job.published ? 'none' : `1px solid ${BRAND.borderStrong}`,
            borderRadius: '9px',
            background: job.published ? BRAND.successBg : '#fff',
            color: job.published ? BRAND.successText : BRAND.inkSoft,
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: job.published ? 'default' : 'pointer',
          }}
        >
          {job.published ? 'Added to product' : 'Add to product'}
        </button>
      )}
    </div>
  );
}
