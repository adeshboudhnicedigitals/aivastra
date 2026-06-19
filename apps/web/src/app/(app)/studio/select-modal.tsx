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
}: SelectGridModalProps<T>) {
  return (
    <div
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
      <div
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
                  <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    style={{ cursor: 'pointer', textAlign: 'center' }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: aspect ? undefined : cardHeight,
                        aspectRatio: aspect,
                        borderRadius: 8,
                        overflow: 'hidden',
                        position: 'relative',
                        border: selected ? '2px solid transparent' : `2px solid ${C.border}`,
                        backgroundImage: selected
                          ? 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)'
                          : 'none',
                        padding: selected ? 2 : 0,
                        boxSizing: 'border-box',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 6,
                          overflow: 'hidden',
                          background: C.lighter,
                        }}
                      >
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
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
                            background: 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <CheckIcon color={C.white} size={11} />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginTop: 8 }}>
                      {item.label}
                    </div>
                  </div>
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
                background: 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)',
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
