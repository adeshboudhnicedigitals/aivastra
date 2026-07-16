'use client';
import { CheckIcon, XIcon } from '@/components/icons';
import { C } from '@/components/tokens';

interface SelectableItem {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
}

interface SelectGridModalProps<T extends SelectableItem> {
  title: string;
  items: T[];
  selectedIds: string[];
  multiSelect?: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  cardHeight?: number;
  aspect?: number;
  columns?: number;
  continueLabel?: string;
  hideLabels?: boolean;
}

export function SelectGridModal<T extends SelectableItem>({
  title,
  items,
  selectedIds,
  multiSelect = false,
  onSelect,
  onClose,
  cardHeight = 148,
  aspect,
  columns = 4,
  continueLabel,
  hideLabels = false,
}: SelectGridModalProps<T>) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-dismiss backdrop; keyboard users have the visible Close button below
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only, not itself interactive */}
      <div
        role="presentation"
        style={{
          background: C.white,
          borderRadius: 12,
          padding: 24,
          width: 1180,
          height: 857,
          maxWidth: '90vw',
          maxHeight: '90vh',
          boxSizing: 'border-box',
          boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            flexShrink: 0,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.mid,
            }}
          >
            <XIcon size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <p style={{ fontSize: 14, color: C.mid }}>Nothing available yet.</p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: 16,
              }}
            >
              {items.map((item) => {
                const selected = selectedIds.includes(item.id);
                const img = item.previewUrl || item.thumbnailUrl;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    style={{
                      cursor: 'pointer',
                      textAlign: 'center',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: aspect ? undefined : cardHeight,
                        aspectRatio: aspect,
                        background: selected
                          ? `linear-gradient(${C.card}, ${C.card}) padding-box, linear-gradient(135deg, #BD2587 0%, #ff5b94 100%) border-box`
                          : `linear-gradient(${C.card}, ${C.card}) padding-box, linear-gradient(${C.border}, ${C.border}) border-box`,
                        border: '3px solid transparent',
                        borderRadius: 12,
                        padding: 0,
                        boxSizing: 'border-box',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 10,
                          overflow: 'hidden',
                          background: C.lighter,
                        }}
                      >
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          // biome-ignore lint/performance/noImgElement: studio select modal preview
                          <img
                            src={img}
                            alt={item.label}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              objectPosition: 'top center',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              background: C.field,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: C.light,
                              fontSize: 11,
                            }}
                          >
                            {item.label}
                          </div>
                        )}
                      </div>
                      {selected && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #BD2587 0%, #ff5b94 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <CheckIcon color={C.white} size={11} />
                        </div>
                      )}
                    </div>
                    {!hideLabels && (
                      <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginTop: 8 }}>
                        {item.label}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {multiSelect && continueLabel && selectedIds.length > 0 && (
          <div
            style={{
              flexShrink: 0,
              marginTop: 16,
              paddingTop: 16,
              borderTop: `1px solid ${C.border}`,
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #BD2587 100%)',
                color: C.white,
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {continueLabel.replace('{count}', String(selectedIds.length))}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
