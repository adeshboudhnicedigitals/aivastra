import { Glyph } from './PageHead';

export const SUPPORT_EMAIL = 'support@aivastra.com';

// SupportChat (App.tsx) owns the open/close state of the floating chat, so
// callers just click its launcher.
function openChat() {
  document.querySelector<HTMLButtonElement>('[data-support-chat-launcher]')?.click();
}

/**
 * The two ways to reach us, shared by the Help & Support popup and the /support
 * page. `onChat` lets the popup close itself before the chat panel opens.
 */
export function SupportOptions({ onChat }: { onChat?: () => void }) {
  return (
    <div className="av-grid av-g2">
      <section className="av-c av2-support">
        <div className="av2-support-head">
          <span className="av-tile">
            <Glyph size={28}>
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M4 7.5l8 5.5 8-5.5" />
            </Glyph>
          </span>
          <h2 className="av-h2">Email support</h2>
        </div>
        <p className="av-sub">
          Send us the details and we usually reply within 24 hours. For a faster answer, use the
          live chat during business hours.
        </p>
        {/* target=_blank: a mailto: opened inside Shopify admin's embedded iframe is
            otherwise swallowed by the frame and nothing happens. */}
        <a
          className="av-btn-primary"
          href={`mailto:${SUPPORT_EMAIL}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Email us
        </a>
      </section>
      <section className="av-c av2-support">
        <div className="av2-support-head">
          <span className="av-tile">
            <Glyph size={28}>
              <path d="M4 5h16v11H9l-5 4V5z" />
              <path d="M8.5 10h7" />
            </Glyph>
          </span>
          <h2 className="av-h2">Live chat</h2>
        </div>
        <p className="av-sub">Chat with an agent using the chat button, during business hours.</p>
        <button
          type="button"
          className="av-btn-ghost"
          onClick={() => {
            onChat?.();
            openChat();
          }}
        >
          Open chat
        </button>
      </section>
    </div>
  );
}
