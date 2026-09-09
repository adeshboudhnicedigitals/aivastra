import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy — Ai Vastra',
};

const p: React.CSSProperties = { margin: '0 0 12px' };
const ul: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 20 };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="[DRAFT — NOT YET PUBLISHED]">
      <p style={p}>
        <strong>
          This is a working draft prepared for internal and legal review. It is not yet a published
          policy and should not be linked from any live product surface, plugin listing, or app
          store submission until [LEGAL / OWNER] has reviewed and approved it.
        </strong>
      </p>

      <LegalSection heading="1. Who this policy covers">
        <p style={p}>
          This Privacy Policy explains how AI Vastra [REGISTERED LEGAL ENTITY NAME — TO BE
          CONFIRMED; "AI Vastra" is the confirmed trading/brand name] ("Ai Vastra", "we", "us")
          collects, uses, and shares information when you use our web app, our Shopify app, our
          WordPress plugin, or our developer API (together, the "Service").
        </p>
        <p style={p}>
          Corporate Office: #904, 9th Floor, Asian Sun City, Kondapur, Hyderabad. Head Office:
          Salumuri Vari St, Innespeta, Rajahmundry, Andhra Pradesh.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we collect">
        <p style={p}>
          <strong>Account information:</strong> email address, display name, and either a hashed
          password or a Google account identifier if you sign in with Google.
        </p>
        <p style={p}>
          <strong>Content you provide:</strong> garment photos, product images, and — for virtual
          try-on — photos of yourself or your customers, uploaded to generate results. Also any
          message, name, or email you submit through a support or contact form.
        </p>
        <p style={p}>
          <strong>Generated results:</strong> the images and videos our Service produces from your
          uploads, kept as part of your job/generation history.
        </p>
        <p style={p}>
          <strong>Payment information:</strong> we do not collect or store your card details.
          Payments are handled entirely by Razorpay or, for Shopify merchants, by Shopify's own
          billing system — we only receive confirmation that a payment succeeded and its amount.
        </p>
        <p style={p}>
          <strong>Store/site integration data:</strong> if you connect a Shopify store or WordPress
          site, we store the store domain or site origin, a hashed version of any API key you
          generate, and product identifiers needed to render the try-on button — not your store's
          admin credentials.
        </p>
        <p style={p}>
          <strong>Usage data:</strong> generation history, and aggregate interaction events (for
          example, that a try-on widget was opened or a result was added to cart) used for the
          analytics shown in your dashboard.
        </p>
        <p style={p}>
          <strong>Standard technical data:</strong> IP address and browser/device information
          collected automatically for security, rate-limiting, and troubleshooting.
        </p>
      </LegalSection>

      <LegalSection heading="3. How we use this information">
        <ul style={ul}>
          <li>To generate and deliver your virtual try-on or catalogue results.</li>
          <li>To operate your account, process credit purchases, and provide customer support.</li>
          <li>
            To secure the Service — detecting abuse, enforcing rate limits, and preventing fraud.
          </li>
          <li>To understand feature usage in aggregate and improve the Service.</li>
          <li>To comply with legal obligations.</li>
        </ul>
        <p style={p}>
          We do not intentionally use your uploaded photographs or generated results to train
          general-purpose AI models, unless you have been separately informed and have agreed to
          that use. (Confirmed against the live-published aivastra.com Privacy Policy.)
        </p>
        <p style={p}>
          We may also create aggregated or de-identified information from data processed through the
          Service and, where permitted by law, use it for analytics, performance measurement,
          security, product development, service improvement, troubleshooting, and business
          planning. This aggregated data cannot reasonably be used to identify you.
        </p>
      </LegalSection>

      <LegalSection heading="4. Who we share information with">
        <p style={p}>We share information only as needed to provide the Service:</p>
        <ul style={ul}>
          <li>
            <strong>Razorpay</strong> — processes direct credit-pack payments. See{' '}
            <a href="https://razorpay.com/privacy/" style={{ color: 'inherit' }}>
              Razorpay's Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong>Shopify</strong> — for stores that install our Shopify app, handles billing and
            provides the store/product data needed to render the try-on experience.
          </li>
          <li>
            <strong>Google</strong> — only if you choose to sign in with Google, to verify your
            identity.
          </li>
          <li>
            <strong>Email delivery and infrastructure providers</strong> we use to send
            transactional email (e.g. verification, password reset) and to host the Service.
          </li>
        </ul>
        <p style={p}>
          We do not sell your personal information, and we do not use third-party advertising
          trackers.
        </p>
      </LegalSection>

      <LegalSection heading="5. Data retention">
        <ul style={ul}>
          <li>Account data is kept while your account is active.</li>
          <li>
            Uploaded images and generated results are kept as part of your history until you delete
            them or delete your account.
          </li>
          <li>
            An uploaded image that is never used to start a generation is automatically deleted
            after 24 hours.
          </li>
          <li>
            Aggregate storefront widget interaction data is retained for a limited period (currently
            up to 400 days) and is used only for reporting — never for credit, access, or
            authorization decisions.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Your rights">
        <p style={p}>
          You can request access to, correction of, or deletion of your personal data by contacting
          support@aivastra.com. For Shopify merchants, uninstalling the app triggers an automated
          data-erasure process for your store's data, consistent with Shopify's data-protection
          requirements. We aim to honor deletion requests within [TIMEFRAME — LEGAL TO CONFIRM].
        </p>
        <p style={p}>
          Depending on where you live, you may have additional rights (for example, under GDPR or
          India's Digital Personal Data Protection Act) to object to processing, request a copy of
          your data in a portable format, or lodge a complaint with your local data protection
          authority.
        </p>
      </LegalSection>

      <LegalSection heading="7. Security">
        <p style={p}>
          Stored files are held in access-controlled object storage. Sensitive credentials
          (including third-party access tokens) are encrypted at rest. Access to your data is
          restricted to what's needed to operate the Service and is not shared beyond the providers
          listed in Section 4.
        </p>
        <p style={p}>
          No Internet transmission, cloud infrastructure, software application, or storage system
          can be guaranteed to be completely secure. Accordingly, we do not guarantee the absolute
          security of your information.
        </p>
      </LegalSection>

      <LegalSection heading="8. Cookies">
        <p style={p}>
          We use essential cookies to keep you signed in (an access token and a refresh token, the
          latter accessible only to our server, not to page scripts). We do not use third-party
          advertising or cross-site tracking cookies.
        </p>
      </LegalSection>

      <LegalSection heading="9. Children's privacy">
        <p style={p}>
          The Service is not directed at, and should not be used by, anyone under 18. We do not
          knowingly collect personal information from children.
        </p>
      </LegalSection>

      <LegalSection heading="10. International data transfers">
        <p style={p}>
          Our infrastructure providers may process or store data in locations other than your own
          country. [LEGAL TO CONFIRM: hosting region(s) and any transfer safeguards to disclose.]
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to this policy">
        <p style={p}>
          We may update this policy from time to time. If we make material changes, we'll notify you
          by email or through the Service before they take effect.
        </p>
      </LegalSection>

      <LegalSection heading="12. Grievance officer / contact">
        <p style={p}>For privacy questions or requests: support@aivastra.com, +91 7729883692.</p>
        <p style={p}>
          Corporate Office: #904, 9th Floor, Asian Sun City, Kondapur, Hyderabad.
          <br />
          Head Office: Salumuri Vari St, Innespeta, Rajahmundry, Andhra Pradesh.
        </p>
        <p style={p}>
          [LEGAL TO CONFIRM: a named Grievance Officer, required under India's IT Rules for a
          locally operating service — the live aivastra.com Privacy Policy gives the same contact
          details above but does not name a specific officer either.]
        </p>
      </LegalSection>
    </LegalPage>
  );
}
