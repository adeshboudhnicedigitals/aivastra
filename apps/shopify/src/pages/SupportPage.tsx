import { AppFont } from '../components/AppFont';
import { AppPage } from '../components/AppPage';
import { Glyph } from '../components/PageHead';

// SupportChat (App.tsx) owns the open/close state of the floating chat, so this
// page just clicks its launcher.
function openChat() {
  document.querySelector<HTMLButtonElement>('[data-support-chat-launcher]')?.click();
}

export default function SupportPage() {
  return (
    <AppFont>
      <AppPage title="Support" subtitle="Email us, or use the chat button at the bottom right.">
        <div className="av-grid av-g2">
          <section className="av-c" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <span className="av-tile" style={{ width: 64, height: 64, borderRadius: 20 }}>
                <Glyph size={32}>
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M4 7.5l8 5.5 8-5.5" />
                </Glyph>
              </span>
              <h2 className="av-h2">Email support</h2>
            </div>
            <p className="av-sub" style={{ margin: 0, fontSize: 18 }}>
              Send us the details and we usually reply within 24 hours. For a faster answer, open
              the chat in the bottom-right corner during business hours.
            </p>
            <a
              className="av-btn-primary"
              href="mailto:support@aivastra.com"
              style={{ marginTop: 'auto', width: '100%' }}
            >
              Email us
            </a>
          </section>
          <section className="av-c" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <span className="av-tile" style={{ width: 64, height: 64, borderRadius: 20 }}>
                <Glyph size={32}>
                  <path d="M4 5h16v11H9l-5 4V5z" />
                  <path d="M8.5 10h7" />
                </Glyph>
              </span>
              <h2 className="av-h2">Live chat</h2>
            </div>
            <p className="av-sub" style={{ margin: 0, fontSize: 18 }}>
              Chat with an agent using the button at the bottom right, during business hours.
            </p>
            <button
              type="button"
              className="av-btn-ghost"
              style={{ marginTop: 'auto', width: '100%' }}
              onClick={openChat}
            >
              Open chat
            </button>
          </section>
        </div>
      </AppPage>
    </AppFont>
  );
}
