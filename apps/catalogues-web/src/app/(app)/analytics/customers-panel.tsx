import type { CSSProperties } from 'react';
import { C, M } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { BarsIcon, DownloadIcon, RepeatIcon, SearchIcon, UserPlusIcon, UsersIcon } from './icons';
import { bigNumber, card, cardTitle } from './styles';

// Honest empty state: nothing records customer phone numbers yet (the kiosk
// capture ships later), so every figure is "—" and the controls are inert
// rather than showing invented numbers.

const th: CSSProperties = { padding: '0 14px', fontWeight: 700 };

const kpi: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 14,
};

function Kpi({ label, icon, suffix }: { label: string; icon: React.ReactNode; suffix?: string }) {
  return (
    <div style={kpi}>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          background: M.accentTint,
          color: M.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.mid }}>{label}</div>
        <div style={{ ...bigNumber, fontSize: 24, lineHeight: 1.2, color: C.text }}>
          —
          {suffix ? (
            <span style={{ fontSize: 14, fontWeight: 600, color: C.mid }}> {suffix}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CustomersPanel() {
  return (
    <div
      style={{
        ...card,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: M.accent }}>
          <UsersIcon size={28} />
          <h3 style={{ ...cardTitle, fontSize: 20, color: C.text }}>Customer Data</h3>
        </div>
        <GradBtn
          outline
          disabled
          style={{ height: 44, borderRadius: 12, opacity: 0.5, cursor: 'not-allowed' }}
        >
          <DownloadIcon size={18} strokeWidth={2.2} />
          Export (Excel)
        </GradBtn>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))',
          gap: 12,
        }}
      >
        <Kpi label="Total Customers" icon={<UsersIcon size={22} />} />
        <Kpi label="Repeat Customers" icon={<RepeatIcon size={22} />} />
        <Kpi label="New Customers" icon={<UserPlusIcon size={22} />} />
        <Kpi
          label="Avg. Try-Ons"
          icon={<BarsIcon size={22} strokeWidth={2.6} />}
          suffix="/ Customer"
        />
      </div>

      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: 12, display: 'flex' }}>
          <SearchIcon size={20} stroke={C.mid} />
        </span>
        <input
          className="focus-ring"
          type="search"
          disabled
          aria-label="Search by phone number"
          placeholder="Search by phone number..."
          style={{
            width: '100%',
            height: 44,
            padding: '0 14px 0 44px',
            borderRadius: 12,
            border: `1px solid ${C.border2}`,
            background: C.card,
            fontFamily: 'inherit',
            fontSize: 15,
            color: C.text,
            opacity: 0.6,
            cursor: 'not-allowed',
          }}
        />
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table
          aria-label="Customer try-ons"
          style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}
        >
          <thead>
            <tr
              style={{
                height: 42,
                background: C.field,
                color: C.text,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <th scope="col" style={{ ...th, width: 50, textAlign: 'left' }}>
                #
              </th>
              <th scope="col" style={{ ...th, textAlign: 'left' }}>
                Phone Number
              </th>
              <th scope="col" style={{ ...th, width: 88, textAlign: 'center' }}>
                Try-Ons
              </th>
              <th scope="col" style={{ ...th, width: '28%', textAlign: 'right' }}>
                Last Try-On
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={4}
                style={{
                  borderTop: `1px solid ${C.border}`,
                  padding: '28px 14px',
                  textAlign: 'center',
                  fontSize: 14,
                  color: C.mid,
                }}
              >
                Customer data will appear once phone numbers are collected at the kiosk.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
