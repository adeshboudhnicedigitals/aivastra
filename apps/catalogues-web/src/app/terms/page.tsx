import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service — Ai Vastra',
};

const p: React.CSSProperties = { margin: '0 0 12px' };
const ul: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 20 };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="August 25, 2026">
      <p style={p}>
        <strong>
          This page adapts AI Vastra's published Terms of Service (previously scoped only to the
          Shopify app at aivastra.com/terms) to cover every AI Vastra surface — the web app, the
          WordPress plugin, the developer API, and the Shopify app — under one set of Terms. The
          core clauses below (services, eligibility, intellectual property, liability cap,
          termination) are carried over from that published, company-approved document; the scope
          definition and the platform-specific sections (credits/billing, acceptable use,
          AI-accuracy) have been broadened/added to actually fit those other surfaces. Two items
          remain genuinely unresolved even in AI Vastra's own live Terms — governing-law
          jurisdiction and credit-expiry policy — flagged in their sections below, not something to
          treat as decided.
        </strong>
      </p>

      <LegalSection heading="1. Who we are and what this covers">
        <p style={p}>
          These Terms of Service ("Terms") govern your use of the AI Vastra services, including our
          website, web application, WordPress plugin, developer API, and any connected e-commerce
          integration — including our Shopify app (collectively, the "Services"), provided by AI
          Vastra ("we", "our", or "us"), with a Corporate Office at #904, 9th Floor, Asian Sun City,
          Kondapur, Hyderabad and a Head Office at Salumuri Vari St, Innespeta, Rajahmundry, Andhra
          Pradesh. By creating an account, installing our Shopify app, installing our WordPress
          plugin, or otherwise accessing or using the Services, you agree to these Terms.
        </p>
        <p style={p}>
          If you are using the Services on behalf of a business (for example, as a merchant
          generating catalogue images or offering virtual try-on to your own customers), you confirm
          you have authority to bind that business to these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. The Services">
        <p style={p}>AI Vastra provides an AI-powered Virtual Try-On solution that lets you:</p>
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
            Shopify app, or our WordPress plugin, enabling customers to upload a photo and preview
            apparel products before purchasing.
          </li>
        </ul>
        <p style={p}>
          The Services are usage-metered: generating an image or video consumes credits from your
          account balance, purchased as described in Section 5.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accounts, eligibility, and merchant responsibilities">
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
            As a Merchant, you agree to: provide accurate store information; obtain any necessary
            consent from your customers before collecting or processing their photos; and use the
            Services in compliance with applicable laws and any connected platform's (Shopify,
            WordPress) policies.
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
          your customers upload ("Input Content"). By uploading Input Content, you grant AI Vastra a
          license to process it solely to provide the Services to you — generating and delivering
          your try-on or catalogue results. Photos uploaded by customers are processed only to
          generate the requested AI virtual try-on images; Merchants are responsible for informing
          their customers how their data will be used.
        </p>
        <p style={p}>
          We do not intentionally use customer-uploaded photographs or generated results to train
          general-purpose AI models, unless you have been separately informed and have agreed to
          that use — see Section 3 of our{' '}
          <a href="/privacy" style={{ color: 'inherit' }}>
            Privacy Policy
          </a>{' '}
          for the full statement.
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
          <li>
            [LEGAL TO CONFIRM: whether unused credits expire, and if so, on what schedule — AI
            Vastra's own currently-published Terms don't address credit expiry at all, so this is
            genuinely open, not an oversight introduced here.]
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p style={p}>You agree not to:</p>
        <ul style={ul}>
          <li>
            Use the Services to generate unlawful, infringing, defamatory, or sexually explicit
            content, or content depicting a real person without their consent.
          </li>
          <li>
            Attempt to circumvent rate limits, credit metering, or access controls, or use another
            user's or store's API keys without authorization.
          </li>
          <li>
            Reverse engineer, scrape, or attempt to extract the underlying AI models or workflows
            powering the Services.
          </li>
          <li>
            Use the Services in a way that disrupts their infrastructure or other users' access to
            them.
          </li>
          <li>
            Upload malicious software or code, or collect sensitive personal information beyond
            what's needed to generate your result.
          </li>
          <li>
            Violate the rules of any third-party platform you connect (Shopify, WordPress) or engage
            in activity that could reasonably expose AI Vastra or others to legal or regulatory
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
          Results are generated by AI models and are approximations — not guaranteed to be
          photorealistic, accurate representations of fit, color, or drape, or free of visual
          artifacts. Results are provided for illustrative/marketing purposes and should not be
          relied on as a substitute for an actual product photo or fitting.
        </p>
      </LegalSection>

      <LegalSection heading="8. Intellectual property">
        <p style={p}>
          AI Vastra, including its software, AI technology, trademarks, APIs, plugins,
          documentation, and other content, remains the exclusive property of AI Vastra. Except as
          expressly permitted, no right is granted to copy, reproduce, modify, reverse engineer,
          distribute, sell, sublicense, or commercially exploit AI Vastra's proprietary technology.
          Merchants retain ownership of their own products and store content.
        </p>
      </LegalSection>

      <LegalSection heading="9. Third-party services">
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

      <LegalSection heading="10. Disclaimers, limitation of liability, and indemnification">
        <p style={p}>
          The Services are provided "as is" and "as available" without warranties of any kind,
          express or implied. We strive to provide reliable service but do not guarantee
          uninterrupted availability — maintenance, updates, or third-party outages may temporarily
          affect the Services.
        </p>
        <p style={p}>
          To the maximum extent permitted by law, AI Vastra is not liable for indirect, incidental,
          special, consequential, exemplary, or punitive damages arising from or relating to use of
          the Services, AI-generated content, Virtual Try-On results, or Merchant- or
          customer-submitted content. Our total liability for any claim relating to the Services is
          limited to the fees you paid us in the 12 months preceding the claim — matching the cap
          published in AI Vastra's own live Terms & Conditions.
        </p>
        <p style={p}>
          You may be responsible for claims, losses, liabilities, and expenses arising from content
          you upload or submit, your lack of appropriate rights or consents for that content, or
          your violation of applicable law or these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="11. Termination">
        <p style={p}>
          You may stop using the Services and delete your account at any time. Either party may
          otherwise terminate use of the Services at any time; we may suspend or terminate your
          access for violation of these Terms or of applicable law. Upon termination, access to the
          Services may be discontinued and retained data deleted according to our data retention
          policy. Sections intended to survive termination (including Sections 7, 10, and 12)
          continue to apply.
        </p>
      </LegalSection>

      <LegalSection heading="12. Governing law">
        <p style={p}>
          These Terms are governed by the laws of India [LEGAL TO CONFIRM], without regard to
          conflict-of-law principles. Disputes are subject to the exclusive jurisdiction of the
          courts of [CITY — LEGAL TO CONFIRM; not stated in AI Vastra's own currently-published
          Terms either, so this is genuinely still open — likely Hyderabad or Rajahmundry given the
          two office addresses, but needs an explicit answer from legal].
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to these Terms">
        <p style={p}>
          We may update these Terms from time to time. If we make material changes, we'll notify you
          by email or through the Services before they take effect. Continued use after changes take
          effect constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact">
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
