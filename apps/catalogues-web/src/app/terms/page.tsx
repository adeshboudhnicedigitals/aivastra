import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service — Ai Vastra',
};

const p: React.CSSProperties = { margin: '0 0 12px' };
const ul: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 20 };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="[DRAFT — NOT YET PUBLISHED]">
      <p style={p}>
        <strong>
          This is a working draft prepared for internal and legal review. It is not yet a published,
          binding agreement and should not be linked from any live product surface, plugin listing,
          or app store submission until [LEGAL / OWNER] has reviewed and approved it.
        </strong>
      </p>

      <LegalSection heading="1. Who we are and what this covers">
        <p style={p}>
          These Terms of Service ("Terms") govern your access to and use of Ai Vastra, an AI virtual
          try-on and product catalogue generation platform (the "Service"), operated by AI Vastra
          [REGISTERED LEGAL ENTITY NAME — TO BE CONFIRMED; "AI Vastra" is the confirmed
          trading/brand name used on aivastra.com, with a Corporate Office at #904, 9th Floor, Asian
          Sun City, Kondapur, Hyderabad and a Head Office at Salumuri Vari St, Innespeta,
          Rajahmundry, Andhra Pradesh] ("Ai Vastra", "we", "us"). By creating an account, installing
          our Shopify app, installing our WordPress plugin, or otherwise using the Service, you
          agree to these Terms.
        </p>
        <p style={p}>
          If you are using the Service on behalf of a business (for example, as a merchant
          generating catalogue images or offering virtual try-on to your own customers), you confirm
          you have authority to bind that business to these Terms.
        </p>
        <p style={p}>
          [NOTE FOR LEGAL: aivastra.com currently publishes a live Terms of Service, but its
          eligibility and billing clauses are scoped specifically to Shopify merchants ("a valid
          Shopify store", billing "through Shopify Billing") and don't mention the WordPress plugin,
          the direct web app, the developer API, or Razorpay credit-pack purchases. This draft is
          written to cover all of those surfaces — please confirm whether the live page should be
          broadened to match, or whether this document should stay a separate, WordPress/direct-API
          supplement to it.]
        </p>
      </LegalSection>

      <LegalSection heading="2. The Service">
        <p style={p}>Ai Vastra lets you:</p>
        <ul style={ul}>
          <li>
            Upload garment images and generate AI images of models or your own photo wearing them.
          </li>
          <li>
            Generate product catalogue imagery from garment photos for use in your own store or
            marketplace listings.
          </li>
          <li>
            Offer an AI virtual try-on experience to your own customers, through our web app, our
            Shopify app, or our WordPress plugin.
          </li>
        </ul>
        <p style={p}>
          The Service is usage-metered: generating an image or video consumes credits from your
          account balance, purchased as described in Section 5.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accounts and eligibility">
        <ul style={ul}>
          <li>You must be at least 18 years old to create an account.</li>
          <li>
            You are responsible for the accuracy of your account information and for keeping your
            login credentials and API keys confidential.
          </li>
          <li>
            You are responsible for all activity that occurs under your account or API keys,
            including activity from a Shopify store or WordPress site you connect.
          </li>
          <li>
            Notify us promptly at support@aivastra.com if you suspect unauthorized access to your
            account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Content you upload">
        <p style={p}>
          You retain ownership of the garment photos, product images, and personal photos you or
          your customers upload ("Input Content"). By uploading Input Content, you grant Ai Vastra a
          license to process it solely to provide the Service to you (generating and delivering your
          try-on or catalogue results).
        </p>
        <p style={p}>
          We do not intentionally use customer-uploaded photographs or generated results to train
          general-purpose AI models, unless you have been separately informed and have agreed to
          that use. (Confirmed against the live-published aivastra.com Privacy Policy — see Section
          3 of our Privacy Policy for the full statement.)
        </p>
        <p style={p}>
          You are responsible for having the necessary rights and consents for any Input Content you
          upload — including any photo of a person other than yourself. Do not upload content you
          don't have the right to use, or photos of another person without their consent.
        </p>
      </LegalSection>

      <LegalSection heading="5. Credits, billing, and refunds">
        <ul style={ul}>
          <li>
            Credits are purchased in packs and consumed per generation. Pricing is shown at the time
            of purchase.
          </li>
          <li>
            Purchases made directly through our web app are processed by Razorpay as one-time
            payments; applicable taxes (including GST, where applicable) are added at checkout.
          </li>
          <li>
            Purchases made through our Shopify app are billed through Shopify's own billing system,
            including optional auto-refill subscriptions you can enable or cancel at any time from
            your store's settings.
          </li>
          <li>
            Credits are generally non-refundable once consumed. If a generation fails due to an
            error on our side, the credit for that attempt is automatically refunded to your
            balance.
          </li>
          <li>[LEGAL TO CONFIRM: whether unused credits expire, and if so, on what schedule.]</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p style={p}>You agree not to:</p>
        <ul style={ul}>
          <li>
            Use the Service to generate unlawful, infringing, defamatory, or sexually explicit
            content, or content depicting a real person without their consent.
          </li>
          <li>
            Attempt to circumvent rate limits, credit metering, or access controls, or use another
            user's or store's API keys without authorization.
          </li>
          <li>
            Reverse engineer, scrape, or attempt to extract the underlying AI models or workflows
            powering the Service.
          </li>
          <li>
            Use the Service in a way that disrupts its infrastructure or other users' access to it.
          </li>
          <li>
            Upload malicious software or code, or collect sensitive personal information beyond
            what's needed to generate your result.
          </li>
          <li>
            Violate the rules of any third-party platform you connect (Shopify, WordPress) or engage
            in activity that could reasonably expose Ai Vastra or others to legal or regulatory
            liability.
          </li>
        </ul>
        <p style={p}>
          We may suspend or terminate accounts that violate this section, without refunding consumed
          credits.
        </p>
      </LegalSection>

      <LegalSection heading="7. AI-generated results — no guarantee of accuracy">
        <p style={p}>
          Results are generated by AI models and are approximations, not guaranteed to be
          photorealistic, accurate representations of fit, color, or drape, or free of visual
          artifacts. Results are provided for illustrative/marketing purposes and should not be
          relied on as a substitute for an actual product photo or fitting.
        </p>
      </LegalSection>

      <LegalSection heading="8. Third-party services">
        <p style={p}>
          Some features rely on third-party providers acting on our behalf, including Razorpay
          (payments), Shopify (billing and store integration, where applicable), and other
          infrastructure and communication providers described in our{' '}
          <a href="/privacy" style={{ color: 'inherit' }}>
            Privacy Policy
          </a>
          . Your use of those providers' own services (for example, completing a Razorpay checkout)
          is also subject to their terms.
        </p>
      </LegalSection>

      <LegalSection heading="9. Disclaimers and limitation of liability">
        <p style={p}>
          The Service is provided "as is" without warranties of any kind, express or implied. To the
          maximum extent permitted by law, Ai Vastra is not liable for indirect, incidental, or
          consequential damages, and our total liability for any claim relating to the Service is
          limited to the amount you paid us in the 12 months preceding the claim. (Matches the cap
          published in the live aivastra.com Terms & Conditions.)
        </p>
      </LegalSection>

      <LegalSection heading="10. Termination">
        <p style={p}>
          You may stop using the Service and delete your account at any time. We may suspend or
          terminate your access for violation of these Terms or of applicable law. Sections intended
          to survive termination (including Sections 7, 9, and 11) continue to apply.
        </p>
      </LegalSection>

      <LegalSection heading="11. Governing law">
        <p style={p}>
          These Terms are governed by the laws of India [LEGAL TO CONFIRM], without regard to
          conflict-of-law principles. Disputes are subject to the exclusive jurisdiction of the
          courts of [CITY — LEGAL TO CONFIRM; not stated on the live aivastra.com Terms either, so
          still genuinely open — likely Hyderabad or Rajahmundry given the two office addresses, but
          needs an explicit answer from legal].
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to these Terms">
        <p style={p}>
          We may update these Terms from time to time. If we make material changes, we'll notify you
          by email or through the Service before they take effect. Continued use after changes take
          effect constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection heading="13. Contact">
        <p style={p}>Questions about these Terms: support@aivastra.com, +91 7729883692.</p>
        <p style={p}>
          Corporate Office: #904, 9th Floor, Asian Sun City, Kondapur, Hyderabad.
          <br />
          Head Office: Salumuri Vari St, Innespeta, Rajahmundry, Andhra Pradesh.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
