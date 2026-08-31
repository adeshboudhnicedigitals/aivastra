(() => {
  const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
  const SSE_MAX_WAIT_MS = 6 * 60 * 1000;
  const SSE_RECONNECT_DELAY_MS = 1000;

  // Mirrors Zod 3's own `z.string().email()` regex, which is what actually
  // guards the API (`email: z.string().email()` in packages/types/widget.ts).
  // The previous check here was `value.indexOf('@') >= 1`, which is far looser:
  // "john@company", "me@localhost" and "x@y.z" all passed it and were then
  // rejected server-side as a 400, surfacing to the shopper as "make sure it's
  // a clear JPG or PNG" with no route back to the email field. The server stays
  // authoritative — this only exists so the common typo is caught in the one
  // place the shopper can actually fix it.
  const EMAIL_RE =
    /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

  // Upper bounds for every network call on the generation path. A fetch that
  // never settles is worse here than one that fails outright: generationInFlight
  // is released in a `finally`, so a hung request leaves it stuck true and the
  // modal shows the progress step for the rest of the session — reopening
  // cannot recover, because that guard exists precisely to stop a second
  // charge. A rejection at least reaches an error step with a retry button.
  //
  // The upload gets its own, much larger bound: it carries up to
  // MAX_PHOTO_BYTES over whatever connection the shopper is on, where the rest
  // are small JSON round-trips. Still far below the presigned URL's own 600s
  // life, so a PUT that outlives this was never going to land.
  const REQUEST_TIMEOUT_MS = 15 * 1000;
  const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

  // Job creation is the call that spends a credit, and a timeout on it is
  // ambiguous in a way the others are not — the job may exist and be charged
  // for on the far side of a connection that died. There is no idempotency key
  // on this endpoint to make a retry safe, so the bound is set well past any
  // plausible server-side duration (the route is a transaction and an XADD)
  // and only trips on a connection that is genuinely gone.
  const CREATE_JOB_TIMEOUT_MS = 45 * 1000;

  // A status GET that fails is retried this many times before the caller gives
  // up on this round and lets the outer wait loop try again. See pollJobStatus.
  const STATUS_RETRY_ATTEMPTS = 4;
  const STATUS_RETRY_BASE_DELAY_MS = 1000;

  const delay = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  /**
   * A v4-shaped uuid, without assuming crypto.randomUUID exists.
   *
   * It is absent on iOS Safari before 15.4 and in any non-secure context. The
   * previous code called it inside a catch block that was itself meant to
   * handle storage being unavailable, so on such a browser the catch threw —
   * during init, before a single listener was attached, leaving a Try It On
   * button that did nothing at all with data-aivastra-initialized already set.
   *
   * The shape matters: the API validates clientId as `z.string().uuid()` and
   * 400s anything else. Math.random is an acceptable last resort because this
   * id is explicitly a UX limiter, not a security control (see getClientId) —
   * the store daily cap is what actually holds.
   */
  function randomUuid() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [];
        for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
      }
    } catch (_err) {
      /* fall through to the Math.random form below */
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /**
   * fetch with a hard upper bound, rejecting with `timedOut: true` when the
   * bound is what stopped it (as opposed to a genuine network error).
   */
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .catch((err) => {
        // Distinguish our own abort from one the caller/browser raised, so a
        // timeout can be reported as a timeout rather than a generic failure.
        if (controller.signal.aborted) {
          const timeoutErr = new Error(`request timed out after ${timeoutMs}ms`);
          timeoutErr.timedOut = true;
          throw timeoutErr;
        }
        throw err;
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }

  function initWidget(root) {
    if (root.dataset.aivastraInitialized === 'true') return;
    root.dataset.aivastraInitialized = 'true';

    const widgetKey = root.dataset.widgetKey;
    const productId = Number(root.dataset.productId);
    const productTitle = root.dataset.productTitle || '';
    const productUrl = root.dataset.productUrl || '';
    const productImage = root.dataset.productImage || '';
    // Defaulted rather than dereferenced: a missing data-api-base used to throw
    // a TypeError here, killing init before any listener was attached. An empty
    // base only costs the SSE stream, which waitForResult already falls back
    // from to polling on the App Proxy path.
    const apiBase = (root.dataset.apiBase || '').replace(/\/$/, '');
    // SEC-7.1: same-origin path Shopify's App Proxy forwards to the API,
    // HMAC-signed by Shopify itself — no widgetKey header needed on these
    // calls. Fixed by shopify.app.toml's [app_proxy] (prefix "apps", subpath
    // "widget"), not configurable per-store. The SSE events stream stays on
    // apiBase directly (below) — App Proxy's behavior for a long-lived
    // streaming response isn't verified.
    const PROXY_BASE = '/apps/widget';

    const button = root.querySelector('.aivastra-tryon__button');
    const modal = root.querySelector('.aivastra-tryon__modal');
    const modalContent = root.querySelector('.aivastra-tryon__modal-content');
    const closeBtn = root.querySelector('.aivastra-tryon__close');
    const lightbox = root.querySelector('.aivastra-tryon__lightbox');
    const lightboxImage = root.querySelector('.aivastra-tryon__lightbox-image');
    const lightboxCloseBtn = root.querySelector('.aivastra-tryon__lightbox-close');
    const fileInput = root.querySelector('.aivastra-tryon__file-input');
    const avatarImage = root.querySelector('.aivastra-tryon__avatar-image');
    const heading = root.querySelector('.aivastra-tryon__heading');
    // The merchant's configured heading (default "Try It On") — swapped out
    // for "Creating Your Try-On" while generating, "Your Try-On Result" on
    // the single-result view, and "History (N)" on the History grid, restored
    // once the shopper leaves those steps.
    const defaultHeading = heading ? heading.textContent : '';
    const steps = {
      upload: root.querySelector('.aivastra-tryon__step--upload'),
      ready: root.querySelector('.aivastra-tryon__step--ready'),
      progress: root.querySelector('.aivastra-tryon__step--progress'),
      pending: root.querySelector('.aivastra-tryon__step--pending'),
      result: root.querySelector('.aivastra-tryon__step--result'),
      error: root.querySelector('.aivastra-tryon__step--error'),
      email: root.querySelector('.aivastra-tryon__step--email'),
    };

    // Advances through the generating-page copy while a job is in flight.
    // Empty when the merchant set a custom generatingText — tryon-button.liquid
    // renders a single static line in that case instead of this list, so their
    // customization isn't silently overridden.
    const progressLines = steps.progress
      ? steps.progress.querySelectorAll('.aivastra-tryon__progress-line')
      : [];
    let progressLineTimer = null;
    let progressLineIndex = 0;
    const progressCanvas = root.querySelector('.aivastra-tryon__progress-canvas');

    // Shows the shopper's own uploaded photo faintly behind the spinner
    // while generating, via a CSS custom property rather than an <img> tag
    // — a background-image avoids the "1x1 placeholder attribute" trap
    // that bit .aivastra-tryon__lightbox-image, and paints below the
    // canvas's own content by default with no z-index bookkeeping needed.
    function setProgressBackground(url) {
      if (!progressCanvas) return;
      if (url) {
        progressCanvas.style.setProperty('--aivastra-progress-bg-url', `url("${url}")`);
      } else {
        progressCanvas.style.removeProperty('--aivastra-progress-bg-url');
      }
    }
    // Sizes an image's box to the photo's own aspect ratio instead of a flat
    // 3:4 default, so a 16:9 upload renders short and a portrait upload
    // renders tall — the modal's own height then follows since it isn't a
    // fixed box (see the --fit modifier toggled in showStep). Capped both
    // ways so an extreme photo (a wide panorama, an ultra-tall crop) can't
    // collapse the box to nothing or blow the layout out past what's usable.
    // Setting aspect-ratio (not a computed pixel height) keeps this
    // responsive to the container's actual rendered width for free, with no
    // resize listener needed.
    //
    // `target` (whose style.aspectRatio gets set) and `img` (measured for its
    // natural size) are usually the same element — result-image has
    // height:auto, so its own aspect-ratio drives its rendered height. But
    // ready-image is filled via width/height 100%/100% of a separately-sized
    // wrapper (avoiding the placeholder-1x1-attribute trap on an element that
    // can't use aspect-ratio itself, since both its dimensions are already
    // definite), so there `target` is that wrapper, not the img.
    const IMAGE_BOX_MIN_HEIGHT_RATIO = 0.7;
    const IMAGE_BOX_MAX_HEIGHT_RATIO = 1.4;
    function fitToPhotoAspectRatio(target, img) {
      if (!target || !img) return;
      const apply = () => {
        const { naturalWidth, naturalHeight } = img;
        if (!naturalWidth || !naturalHeight) return;
        const ratio = Math.min(
          IMAGE_BOX_MAX_HEIGHT_RATIO,
          Math.max(IMAGE_BOX_MIN_HEIGHT_RATIO, naturalHeight / naturalWidth),
        );
        target.style.aspectRatio = `1 / ${ratio}`;
      };
      if (img.complete && img.naturalWidth) apply();
      else img.addEventListener('load', apply, { once: true });
    }
    const resultList = root.querySelector('.aivastra-tryon__result-list');
    const resultEmpty = root.querySelector('.aivastra-tryon__result-empty');
    const resultCardTemplate = root.querySelector('.aivastra-tryon__result-card-template');
    const readyImage = root.querySelector('.aivastra-tryon__ready-image');
    const readyPreview = root.querySelector('.aivastra-tryon__ready-preview');
    const changePhotoBtn = root.querySelector('.aivastra-tryon__change-photo');
    const ctaBtn = root.querySelector('.aivastra-tryon__cta');

    // The Liquid-rendered default text for the error step's <p> — either the
    // merchant's own cfg.copy.errorText, or the built-in "Something went
    // wrong" line if they never set one. data-custom distinguishes those two
    // cases (see tryon-button.liquid): only an explicit merchant override is
    // captured here, so an un-configured store still gets the more specific
    // built-in fallback text below rather than this generic one.
    const errorMessageEl = steps.error ? steps.error.querySelector('p') : null;
    const merchantErrorText =
      errorMessageEl && errorMessageEl.dataset.custom === 'true'
        ? errorMessageEl.textContent
        : null;

    // The backend's own AppError/Zod-validation message is never shown
    // verbatim (it can be raw Zod-issue text, or just phrased for a
    // developer, not a shopper) — every 4xx from presign/createJob is mapped
    // through this instead, keyed on status/code alone. The one exception is
    // a 413 (BAD_UPLOAD's "too large" flavor — see customer.routes.ts): its
    // message is deterministic ("uploaded photo exceeds NMB limit") and N is
    // an admin-configurable value (default 20MB, but not fixed) with no safe
    // number to hardcode here instead — a hardcoded "under 25MB" would just
    // drift out of sync with whatever the store is actually configured for.
    function friendlyClientErrorMessage(status, code, backendMessage) {
      if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT') {
        return 'Lots of people are trying this on right now. Please wait a moment and try again.';
      }
      // The store's own setup is wrong or the app is no longer installed:
      // a rejected App Proxy signature, an uninstalled/unknown shop, a stale
      // widget key, or a storefront origin missing from the store's allowlist.
      // Nothing the shopper does changes any of it, so this must not be the
      // photo copy — that sent them re-cropping and re-uploading forever
      // against a wall only the merchant can move. Deliberately makes no
      // "check back later" promise either: unlike running out of credits, this
      // does not fix itself with time. The merchant-facing signal is the
      // server-side warn in shopify-widget-auth.ts, not anything shown here.
      if (status === 401 || code === 'ORIGIN_NOT_ALLOWED') {
        return "Try-on isn't available on this store right now.";
      }
      if (status === 413 && backendMessage) {
        const capitalized = backendMessage.charAt(0).toUpperCase() + backendMessage.slice(1);
        return `${capitalized}. Please choose a smaller photo and try again.`;
      }
      return "We had trouble with that photo. Please make sure it's a clear JPG or PNG and try again.";
    }

    const emailInput = root.querySelector('.aivastra-tryon__email-input');
    const emailConsentInput = root.querySelector('.aivastra-tryon__email-consent-input');
    const emailSubmit = root.querySelector('.aivastra-tryon__email-submit');
    const emailError = root.querySelector('.aivastra-tryon__email-error');
    let awaitingEmailForPhotoKey = null;

    function showEmailError(message) {
      if (!emailError) return;
      emailError.textContent = message;
      emailError.hidden = false;
    }

    /**
     * Send the shopper back to the email field with a reason.
     *
     * The address is the only free-text the shopper contributes to a job, so a
     * validation refusal is almost always about it — and the generic error step
     * is a dead end for that: its retry button runs startOver(), which drops
     * them back at the photo they already picked with no way to correct what
     * was actually wrong. Re-arming awaitingEmailForPhotoKey reuses the very
     * same upload, so a corrected address costs no second upload and no second
     * charge.
     */
    function returnToEmailStep(photoKey, message) {
      awaitingEmailForPhotoKey = photoKey;
      showStep('email');
      showEmailError(message);
    }

    // True from the moment a generation is confirmed until it settles.
    //
    // Closing the modal does NOT cancel the request — the job is already
    // queued and the store already charged, and nothing on this side can
    // un-charge it. So the modal has to remember: without this, reopening ran
    // startOver(), which showed the shopper their remembered photo and a
    // "Try It On Now" button while the first generation was still running.
    // Clicking it charged the merchant a second time for a duplicate of a
    // try-on already on its way — and both flows then fought over the screen.
    let generationInFlight = false;

    /**
     * A result that finished while the modal was shut, waiting to be shown
     * when the shopper comes back.
     *
     * Rendering into a hidden modal is pointless: openModal runs startOver(),
     * which resets to upload/ready and wipes it — so someone who closed the
     * modal to wait would return to a "pick a photo" screen, their finished
     * try-on reachable only by then noticing the history badge. Holding it
     * here lets openModal show the thing they were waiting for.
     */
    let pendingResultView = null;

    /**
     * The same idea for a failure: the message to show on reopen.
     *
     * More important than the result case, not less — a failed try-on leaves
     * no history entry, so a message wiped by startOver() is gone for good and
     * the shopper is left with no idea what became of their photo.
     */
    let pendingErrorView = null;

    /**
     * Whether the shopper is still watching this generation, and so should be
     * taken to its result when it lands.
     *
     * False once they have navigated somewhere else on purpose — History is
     * reachable from the progress step — because yanking someone out of what
     * they chose to look at loses their place. The result is recorded either
     * way; the history badge is how they find it. A closed modal is handled
     * separately, by pendingResultView above.
     */
    function isAwaitingGeneration() {
      return steps.progress ? !steps.progress.hidden : false;
    }

    if (avatarImage && productImage) {
      avatarImage.src = productImage;
      avatarImage.hidden = false;
    }

    const backBtn = root.querySelector('.aivastra-tryon__back-btn');
    const historyBtn = root.querySelector('.aivastra-tryon__history-btn');
    const historyBadge = root.querySelector('.aivastra-tryon__history-badge');
    // Where backBtn should land while the result step is showing: 'flow'
    // returns to the upload/ready flow via startOver(); 'history' means the
    // shopper drilled into a single tile from the History grid, so back
    // should pop one level to the grid instead of leaving history entirely.
    let resultBackTarget = 'flow';
    // The entry currently shown in the single-card result view (fresh
    // generation or a History tile) — kept so the History button can restore
    // it when back leaves the grid it opened.
    let currentResultEntry = null;
    // Snapshot of { backTarget, entry } taken when the History button is
    // pressed from a single-card view, so backBtn can pop the grid back to
    // exactly that card instead of always leaving via startOver().
    let historyReturn = null;
    const HISTORY_STORAGE_KEY = 'aivastra_tryon_history';

    const CLIENT_ID_STORAGE_KEY = 'aivastra_client_id';

    // One anonymous id per browser, minted once. This is a UX limiter, not a
    // security control: incognito, cleared storage, or a script all defeat it.
    // The store daily cap is what actually holds — see the design doc.
    function getClientId() {
      try {
        let id = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
        if (!id) {
          id = randomUuid();
          localStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
        }
        return id;
      } catch (_err) {
        // Storage blocked (Safari private mode, etc.) — a per-call id still
        // lets the server create a row; it just won't persist across reloads.
        // randomUuid, not crypto.randomUUID: this catch must not be able to
        // throw, or init dies here and the button silently does nothing.
        return randomUuid();
      }
    }

    const clientId = getClientId();

    // Coarse and honest: a width test, not device detection. Labeled as an
    // estimate in the merchant UI rather than presented as fact.
    const device = window.innerWidth < 768 ? 'mobile' : 'desktop';

    // Fire-and-forget. Analytics must never break a try-on, so every failure
    // path here is silent: a rejected promise, a thrown TypeError from a
    // missing API, an ad blocker eating the request — all identical to success
    // from the shopper's point of view.
    //
    // keepalive matters for add_to_cart specifically: the shopper may navigate
    // to /cart before the request settles, and without it the browser cancels
    // the very event that measures conversion.
    function trackEvent(type) {
      try {
        fetch(`${PROXY_BASE}/customer/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            clientId: clientId || undefined,
            shopifyProductId: productId || undefined,
            device,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* analytics must never break a try-on */
      }
    }

    const shopifyCustomerId = root.dataset.customerId ? Number(root.dataset.customerId) : undefined;
    // Prefill only. The server never trusts this for authorization.
    let shopperEmail = root.dataset.customerEmail || null;
    let shopperEmailConsent = false;
    // Whether the shopper actually submitted the email-gate step, as opposed to
    // us merely knowing their address because Liquid rendered it for a
    // logged-in customer. Only a true value permits sending the address to the
    // server: a prefilled value is a convenience, not an act of consent, and
    // the merchant's "Collected emails" list is supposed to contain only
    // addresses a shopper deliberately handed over.
    let emailConfirmedByShopper = false;

    if (emailInput && shopperEmail) emailInput.value = shopperEmail;

    if (emailSubmit) {
      emailSubmit.addEventListener('click', () => {
        const value = (emailInput?.value ? emailInput.value : '').trim();
        // Shape check only; the server's Zod schema is still the real
        // validation. Kept deliberately in step with it — see EMAIL_RE.
        if (!EMAIL_RE.test(value)) {
          showEmailError('Enter a valid email address.');
          return;
        }
        if (emailError) emailError.hidden = true;
        shopperEmail = value;
        shopperEmailConsent = !!emailConsentInput?.checked;
        // This click is the affirmative action. Until it happens, createJob
        // sends no email at all, even for a logged-in customer whose address
        // was prefilled into the input above.
        emailConfirmedByShopper = true;
        const key = awaitingEmailForPhotoKey;
        awaitingEmailForPhotoKey = null;
        if (key) {
          showStep('progress');
          // Same in-flight guard as confirmReady: this retry re-enters the
          // same charged path, so the modal must not offer a second one while
          // it runs. proceedWithPhoto handles its own errors, so the catch is
          // only here to stop a stray rejection surfacing as an unhandled one.
          generationInFlight = true;
          proceedWithPhoto(key, false)
            .catch((err) => {
              console.error('[aivastra tryon] generation failed after email step', err);
            })
            .finally(() => {
              generationInFlight = false;
            });
        }
      });
    }

    // Photo picked (new upload or "use this photo" reuse) but generation not
    // yet confirmed — set by showReady(), consumed and cleared once the CTA
    // is clicked. Exactly one of the two is set at a time.
    let pendingFile = null;
    let pendingReuseKey = null;

    const reuseExpiredNote = root.querySelector('.aivastra-tryon__reuse-expired-note');

    // Themes routinely give a section ancestor `transform`, `filter`, or
    // `contain` (sticky headers, gallery/parallax sections). That makes the
    // ancestor the containing block for `position: fixed`, so our modal gets
    // trapped inside its stacking context — the header and product images
    // then render on top no matter how high z-index goes. Reparenting to
    // <body> escapes every ancestor's stacking context. The custom
    // properties (button/text color, radius, accent) live on `root`'s inline
    // style and are normally inherited; copy them over since the modal is no
    // longer a descendant of root once moved.
    for (const el of [modal, lightbox]) {
      if (!el) continue;
      el.style.cssText = root.style.cssText + el.style.cssText;
      document.body.appendChild(el);
    }

    const REUSE_STORAGE_KEY = 'aivastra_last_photo';
    const REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

    function getRememberedPhoto() {
      let raw;
      try {
        raw = localStorage.getItem(REUSE_STORAGE_KEY);
      } catch (_err) {
        return null;
      }
      if (!raw) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_err) {
        return null;
      }
      if (!parsed || typeof parsed.r2Key !== 'string' || typeof parsed.uploadedAt !== 'number') {
        return null;
      }
      if (Date.now() - parsed.uploadedAt > REUSE_MAX_AGE_MS) return null;
      return { r2Key: parsed.r2Key };
    }

    function rememberPhoto(r2Key) {
      try {
        localStorage.setItem(REUSE_STORAGE_KEY, JSON.stringify({ r2Key, uploadedAt: Date.now() }));
      } catch (_err) {
        /* private-browsing / storage-full — reuse just won't be offered next time */
      }
    }

    function forgetPhoto() {
      try {
        localStorage.removeItem(REUSE_STORAGE_KEY);
      } catch (_err) {
        /* ignore */
      }
    }

    // Entry point for the main flow (modal open, "Try another pose", "Try
    // again"): a returning shopper with a remembered photo goes straight to
    // the ready screen with it pre-loaded (design frame 3) instead of
    // revisiting the upload step. No remembered photo (or it's expired /
    // no longer owned) falls back to a fresh upload.
    async function enterMainFlow() {
      const remembered = getRememberedPhoto();
      if (!remembered) {
        showStep('upload');
        return;
      }
      try {
        // Bounded like every other call: this one is awaited by openModal, so a
        // hang leaves the modal open with every step hidden — an empty box the
        // shopper can only close. The catch below falls back to the upload step.
        const res = await fetchWithTimeout(
          `${PROXY_BASE}/customer/photo/preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ r2Key: remembered.r2Key }),
          },
          REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) {
          forgetPhoto();
          showStep('upload');
          return;
        }
        const body = await res.json();
        showReady({ reuseKey: remembered.r2Key, previewUrl: body.previewUrl });
      } catch (_err) {
        showStep('upload');
      }
    }

    function startProgressRotator() {
      if (!progressLines.length) return;
      progressLineIndex = 0;
      for (let i = 0; i < progressLines.length; i++) {
        progressLines[i].classList.toggle('is-active', i === 0);
      }
      // Advances one line every 6s and stops on the last line ("Almost
      // there…") instead of looping back to the start — a job can outlast
      // the sequence, and holding on the final message reads better than
      // cycling back through copy that no longer matches how long this has
      // taken.
      progressLineTimer = setInterval(() => {
        if (progressLineIndex >= progressLines.length - 1) {
          clearInterval(progressLineTimer);
          progressLineTimer = null;
          return;
        }
        progressLines[progressLineIndex].classList.remove('is-active');
        progressLineIndex += 1;
        progressLines[progressLineIndex].classList.add('is-active');
      }, 6000);
    }

    function stopProgressRotator() {
      if (progressLineTimer) {
        clearInterval(progressLineTimer);
        progressLineTimer = null;
      }
    }

    function showStep(name) {
      for (const key in steps) {
        if (steps[key]) steps[key].hidden = key !== name;
      }
      if (name === 'progress') startProgressRotator();
      else stopProgressRotator();
      // 'ready', 'progress' and 'result' are the only steps whose box height
      // should follow an actual photo's aspect ratio (see
      // fitToPhotoAspectRatio) — every other step keeps the modal at its
      // normal fixed size. Capped by the modal's own max-height either way,
      // so a long History list still scrolls instead of growing unbounded.
      if (modalContent) {
        modalContent.classList.toggle(
          'aivastra-tryon__modal-content--fit',
          name === 'ready' || name === 'progress' || name === 'result',
        );
      }
      syncHeaderButton();
    }

    // Overrides the merchant-configured error copy with a specific reason.
    // Used for client-side validation failures (bad file type, oversized
    // photo) as well as the 402 "try-on unavailable" case below.
    function showErrorWithMessage(message) {
      // Nobody is looking, and openModal's startOver() would wipe the error
      // step before they were. Hold it and show it when they return.
      if (modal.hidden) {
        pendingErrorView = message;
        return;
      }
      showStep('error');
      const errorStep = steps.error;
      if (errorStep) {
        const p = errorStep.querySelector('p');
        if (p) p.textContent = message;
      }
    }

    function getHistory() {
      let raw;
      try {
        raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      } catch (_err) {
        return [];
      }
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_err) {
        return [];
      }
    }

    // backBtn appears whenever the result step (single card or History grid)
    // is active. historyBtn additionally hides, and the heading names the
    // view, specifically while the History grid itself is showing — a
    // shopper already looking at their history has no need for a button that
    // opens the same view.
    function syncHeaderButton() {
      const onResult = steps.result ? !steps.result.hidden : false;
      const onHistoryGrid = onResult && !!resultList?.classList.contains(RESULT_LIST_GRID_CLASS);
      const onProgress = steps.progress ? !steps.progress.hidden : false;
      const count = getHistory().length;
      if (backBtn) backBtn.hidden = !onResult;
      if (historyBtn) historyBtn.hidden = onHistoryGrid || count === 0;
      if (historyBadge) {
        historyBadge.hidden = count === 0;
        historyBadge.textContent = String(count);
      }
      if (heading) {
        heading.textContent = onHistoryGrid
          ? `History (${count})`
          : onResult
            ? 'Your Try-On Result'
            : onProgress
              ? 'Creating Your Try-On'
              : defaultHeading;
      }
    }

    // Fires each time a job completes. resultUrl is a presigned R2 URL (1h
    // TTL) — it WILL go stale while an entry sits in localStorage across
    // browser sessions, so every render re-signs from jobId via
    // resolveHistoryEntry() rather than trusting the cached string. jobId is
    // what makes that possible; it's stored alongside the URL for exactly
    // that purpose. History is per-browser and spans every product tried on
    // this store, same pattern as the "reuse last photo" feature: no
    // server-side concept of a widget shopper's identity exists to key a
    // real history endpoint off of.
    function addToHistory(resultUrl, jobId) {
      const entry = {
        resultUrl,
        jobId,
        createdAt: Date.now(),
        productTitle,
        productUrl,
      };
      const history = [entry, ...getHistory()];
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      } catch (_err) {
        /* private-browsing / storage-full — history just won't persist */
      }
      syncHeaderButton();
    }

    // Fixed-position and a sibling of .aivastra-tryon__modal (not nested
    // inside it) so it covers the full viewport rather than being clipped
    // to the modal's fixed 400x700 box — a "full page" view, not a bigger
    // card.
    function openLightbox(url) {
      if (!lightbox || !lightboxImage || !url) return;
      lightboxImage.src = url;
      lightbox.hidden = false;
    }

    function closeLightbox() {
      if (!lightbox) return;
      lightbox.hidden = true;
      if (lightboxImage) lightboxImage.src = '';
    }

    // navigator.share is absent on desktop Firefox and older Safari. The
    // payload is a plain public URL either way, so the fallback is a clipboard
    // copy rather than hiding the affordance — a share button that vanishes on
    // some browsers leaves the result actions visibly lopsided.
    function shareResult(url, flashEl) {
      trackEvent('share');
      if (!url) return;
      if (typeof navigator.share === 'function') {
        navigator.share({ url }).catch(() => {
          /* user cancelled the share sheet — nothing to do */
        });
        return;
      }
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(url).then(
        () => flashShare(flashEl, 'Link copied'),
        () => flashShare(flashEl, 'Copy failed'),
      );
    }

    // The shopper's live variant selection lives in the theme's own product
    // form, which every Shopify product page has. data-default-variant-id is
    // the Liquid-rendered fallback for themes that render the form lazily.
    function resolveVariantId() {
      const input = document.querySelector('form[action*="/cart/add"] [name="id"]');
      const fromForm = input ? Number(input.value) : 0;
      if (fromForm) return fromForm;
      const templateBtn = resultCardTemplate
        ? resultCardTemplate.content.querySelector('.aivastra-tryon__add-to-cart')
        : null;
      const fallback = templateBtn ? Number(templateBtn.dataset.defaultVariantId) : 0;
      return fallback || null;
    }

    const shareFlashTimers = new WeakMap();
    function flashShare(flashEl, message) {
      if (!flashEl) return;
      flashEl.textContent = message;
      flashEl.hidden = false;
      clearTimeout(shareFlashTimers.get(flashEl));
      shareFlashTimers.set(
        flashEl,
        setTimeout(() => {
          flashEl.hidden = true;
        }, 2000),
      );
    }

    async function addVariantToCart(btn, errorEl, viewCartEl) {
      const variantId = resolveVariantId();
      if (!variantId) return;

      btn.disabled = true;
      if (errorEl) errorEl.hidden = true;

      try {
        // Bounded so a stalled request can't leave the button disabled forever
        // with no error shown — the catch below re-enables it.
        const res = await fetchWithTimeout(
          '/cart/add.js',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
          },
          REQUEST_TIMEOUT_MS,
        );

        if (!res.ok) {
          // Sold-out and every other refusal comes back as a 422 with a human
          // message. Showing Shopify's own string beats tracking variant
          // availability client-side across each theme's selector JS.
          const body = await res.json().catch(() => ({}));
          if (errorEl) {
            errorEl.textContent = body.description || 'Could not add to cart.';
            errorEl.hidden = false;
          }
          btn.disabled = false;
          return;
        }

        if (btn.classList.contains('aivastra-tryon__add-to-cart-overlay')) {
          btn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        } else {
          btn.textContent = 'Added ✓';
        }
        trackEvent('add_to_cart');
        if (viewCartEl) viewCartEl.hidden = false;
        // Themes that listen refresh their cart badge; the rest ignore an
        // unknown event. Cheaper and safer than detecting each theme's drawer.
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      } catch {
        if (errorEl) {
          errorEl.textContent = 'Could not add to cart.';
          errorEl.hidden = false;
        }
        btn.disabled = false;
      }
    }

    // Identity for a history entry: jobId when present (every entry written
    // after this fix has one), falling back to the resultUrl string for
    // entries persisted before jobId existed — those can never be re-signed
    // and age out via the onerror handler below instead.
    function removeHistoryEntry(entry) {
      const remaining = getHistory().filter((h) =>
        entry.jobId ? h.jobId !== entry.jobId : h.resultUrl !== entry.resultUrl,
      );
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(remaining));
      } catch (_err) {
        // Storage blocked — the entry reappears next load; harmless.
      }
    }

    // resultUrl is a 1h-presigned link, so a cached entry's URL is almost
    // always stale by the time history is re-opened. Re-fetch a fresh one
    // from the job's current state before rendering; a null resultUrl back
    // from the API means retention actually deleted the object, so the entry
    // is dropped for real rather than left to fail on load. Legacy entries
    // with no jobId (persisted before this fix shipped) can't be re-signed —
    // rendered as-is and left to the <img> onerror fallback.
    async function resolveHistoryEntry(entry) {
      if (!entry.jobId) return entry;
      try {
        const status = await fetchJobStatus(entry.jobId);
        if (!status.resultUrl) {
          removeHistoryEntry(entry);
          return null;
        }
        return { ...entry, resultUrl: status.resultUrl };
      } catch (_err) {
        // Transient network failure — keep the cached entry rather than
        // dropping real history over it; a genuine 404 still surfaces via
        // the <img> onerror fallback below.
        return entry;
      }
    }

    // Builds one result card, cloned fresh from the Liquid <template> each
    // time so its Add to Cart / Share state never needs resetting between
    // renders.
    //
    // actions=false is the History grid view: the tile itself is tappable
    // (opens the lightbox directly) and carries its own Add to Cart/Share/
    // expand buttons. actions=true is the full-size single-result view shown
    // right after a fresh generation, with the same actions below the image
    // instead of overlaid on the tile.
    function buildResultCard(entry, { actions = true } = {}) {
      const fragment = resultCardTemplate.content.cloneNode(true);
      const card = fragment.querySelector('.aivastra-tryon__result-card');

      const img = card.querySelector('.aivastra-tryon__result-image');
      img.src = entry.resultUrl;
      // Belt-and-braces: resolveHistoryEntry() already re-signs before this
      // card is built, so this only fires on a genuinely dead object (or a
      // legacy entry with no jobId to re-sign from). The History grid has a
      // list to refresh; the single-result view (fresh generation) has only
      // this one card, so it just falls back to the empty state instead.
      img.addEventListener('error', () => {
        removeHistoryEntry(entry);
        if (resultList?.classList.contains(RESULT_LIST_GRID_CLASS)) {
          renderResultList();
        } else if (resultList) {
          resultList.innerHTML = '';
          if (resultEmpty) resultEmpty.hidden = false;
        }
      });

      const expandBtn = card.querySelector('.aivastra-tryon__expand');
      const addToCartBtn = card.querySelector('.aivastra-tryon__add-to-cart');
      const addToCartOverlayBtn = card.querySelector('.aivastra-tryon__add-to-cart-overlay');
      const cartError = card.querySelector('.aivastra-tryon__cart-error');
      const viewCartLink = card.querySelector('.aivastra-tryon__view-cart');
      const shareBtn = card.querySelector('.aivastra-tryon__share');
      const shareOverlayBtn = card.querySelector('.aivastra-tryon__share-overlay');
      const shareFlash = card.querySelector('.aivastra-tryon__share-flash');
      const tryAnotherBtn = card.querySelector('.aivastra-tryon__try-another');

      if (!actions) {
        card.classList.add('aivastra-tryon__result-card--compact');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', () => openHistoryDetail(entry));
        card.addEventListener('keydown', (e) => {
          // Only the tile's own focus ring should open the detail view —
          // Enter/Space on the nested expand/Add to Cart/Share buttons must
          // not also bubble into this (their own click handlers below
          // already stopPropagation, but keydown bubbles independently of
          // that).
          if (e.target !== card) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openHistoryDetail(entry);
          }
        });
        // Expand, Add to Cart and Share act on the tile directly (fullscreen
        // preview, quick purchase, sharing) instead of drilling into the
        // full detail view — stopPropagation so they don't also trigger the
        // tile's own click-through to openHistoryDetail.
        if (expandBtn) {
          expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(entry.resultUrl);
          });
        }
        if (addToCartBtn) {
          addToCartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addVariantToCart(addToCartBtn, cartError, viewCartLink);
          });
        }
        if (shareBtn) {
          shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            shareResult(entry.resultUrl, shareFlash);
          });
        }
        return card;
      }

      // Full-size view only — the History grid keeps every tile at the base
      // 3:4 ratio so the 2-up layout stays uniform regardless of each
      // result's actual shape.
      fitToPhotoAspectRatio(img, img);

      if (expandBtn) {
        expandBtn.addEventListener('click', () => openLightbox(entry.resultUrl));
      }
      if (addToCartOverlayBtn) {
        addToCartOverlayBtn.addEventListener('click', () =>
          addVariantToCart(addToCartOverlayBtn, cartError, viewCartLink),
        );
      }
      if (shareOverlayBtn) {
        shareOverlayBtn.addEventListener('click', () => shareResult(entry.resultUrl, shareFlash));
      }
      // Picking a file here reuses the same fileInput 'change' handler as the
      // upload step and Change Photo — it always routes through showReady()
      // for a confirm-and-generate step, same as any other photo pick.
      if (tryAnotherBtn) {
        tryAnotherBtn.addEventListener('click', () => fileInput.click());
      }
      return card;
    }

    const RESULT_LIST_GRID_CLASS = 'aivastra-tryon__result-list--grid';

    // The History button's view: a 2-up, no-actions-row gallery of everything
    // the shopper has generated. The result step otherwise shows a single
    // card (see renderSingleResult) — this is the one place the full history
    // list renders at once.
    async function renderResultList() {
      const history = getHistory();
      syncHeaderButton();
      // Fixed 70dvh instead of --fit's photo-driven auto height — a grid of
      // many tiles has no single aspect ratio to size around, so it gets a
      // constant, scrollable viewport instead.
      if (modalContent) modalContent.classList.add('aivastra-tryon__modal-content--history');
      if (!resultList) return;
      resultList.classList.add(RESULT_LIST_GRID_CLASS);
      resultList.innerHTML = '';
      const resolved = (await Promise.all(history.map(resolveHistoryEntry))).filter(Boolean);
      if (resultEmpty) resultEmpty.hidden = resolved.length > 0;
      for (let i = 0; i < resolved.length; i++) {
        resultList.appendChild(buildResultCard(resolved[i], { actions: false }));
      }
    }

    // The result step's other state: exactly one card, full-size, with Add
    // to Cart / Share — used both right after a fresh generation and when a
    // History tile is tapped.
    function renderSingleResult(entry) {
      currentResultEntry = entry;
      if (modalContent) modalContent.classList.remove('aivastra-tryon__modal-content--history');
      if (!resultList) return;
      resultList.classList.remove(RESULT_LIST_GRID_CLASS);
      resultList.innerHTML = '';
      resultList.appendChild(buildResultCard(entry, { actions: true }));
      if (resultEmpty) resultEmpty.hidden = true;
    }

    // Tapping a History tile opens that one result full-size, same layout
    // (single column, Add to Cart / Share) as the just-generated result —
    // browsing history shouldn't be a dead end without a purchase path.
    function openHistoryDetail(entry) {
      resultBackTarget = 'history';
      renderSingleResult(entry);
      showStep('result');
    }

    // backBtn's behavior depends on how the shopper got to the result step:
    // popping one level back to the History grid when they drilled into a
    // tile, restoring the single card they were viewing when they opened the
    // grid via the History button, or otherwise leaving the result feed
    // entirely for the main flow.
    async function handleBack() {
      if (resultBackTarget === 'history') {
        resultBackTarget = 'flow';
        await renderResultList();
        showStep('result');
        return;
      }
      if (resultBackTarget === 'entry' && historyReturn) {
        const { backTarget, entry } = historyReturn;
        historyReturn = null;
        resultBackTarget = backTarget;
        renderSingleResult(entry);
        showStep('result');
        return;
      }
      startOver();
    }

    function resetReadyPreview() {
      if (readyImage) {
        if (readyImage.src) URL.revokeObjectURL(readyImage.src);
        readyImage.src = '';
      }
      if (readyPreview) readyPreview.style.removeProperty('aspect-ratio');
      pendingFile = null;
      pendingReuseKey = null;
    }

    // Shows the picked photo (new upload or reused) full-size with an
    // explicit "Try It On Now" CTA, instead of generating immediately —
    // exactly one of file/reuseKey is passed by the two callers. This is the
    // single convergence point for both a freshly-picked file
    // (handlePickedFile) and a remembered reuse photo (enterMainFlow), so the
    // 'upload' funnel event fires here rather than in either caller — firing
    // it in handlePickedFile alone under-counts returning shoppers who never
    // touch the file input.
    function showReady({ file, reuseKey, previewUrl }) {
      // A prior History grid visit could leave this class on modalContent —
      // clear it so the ready step gets its normal photo-driven auto height
      // instead of the grid's fixed 70dvh.
      if (modalContent) modalContent.classList.remove('aivastra-tryon__modal-content--history');
      resetReadyPreview();
      pendingFile = file || null;
      pendingReuseKey = reuseKey || null;
      if (readyImage) {
        readyImage.src = file ? URL.createObjectURL(file) : previewUrl || '';
        fitToPhotoAspectRatio(readyPreview, readyImage);
      }
      trackEvent('upload');
      showStep('ready');
    }

    function startOver() {
      fileInput.value = '';
      resetReadyPreview();
      if (reuseExpiredNote) reuseExpiredNote.hidden = true;
      enterMainFlow();
    }

    function openModal() {
      trackEvent('button_click');
      modal.hidden = false;
      // Show the generation they already paid for, not a fresh CTA to buy
      // another one. startOver() would reset to upload/ready and re-offer the
      // remembered photo — see generationInFlight.
      if (generationInFlight) {
        showStep('progress');
        return;
      }
      // Failed while they were away. Checked before the result below purely
      // for clarity — a generation ends one way or the other, so only one of
      // the two can ever be set.
      if (pendingErrorView) {
        const message = pendingErrorView;
        pendingErrorView = null;
        showErrorWithMessage(message);
        return;
      }
      // Finished while they were away: show it instead of the upload screen.
      // trackEvent fires here rather than at completion because this is the
      // moment it is actually seen.
      if (pendingResultView) {
        const entry = pendingResultView;
        pendingResultView = null;
        resultBackTarget = 'flow';
        renderSingleResult(entry);
        showStep('result');
        trackEvent('result_view');
        return;
      }
      startOver();
    }

    function closeModal() {
      modal.hidden = true;
    }

    async function uploadPhoto(file) {
      const presignRes = await fetchWithTimeout(
        `${PROXY_BASE}/customer/presign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, contentLength: file.size, clientId }),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!presignRes.ok) {
        // 4xx here means the API rejected this specific photo (e.g. content
        // type) or rate-limited this store; a 5xx is our own infra. Either
        // way the backend's own message is never shown as-is — it can be a
        // raw Zod-validation string, not shopper copy — only its error code
        // is read, mapped to fixed friendly text below.
        const errBody = await presignRes.json().catch(() => ({}));
        const err = new Error('presign failed');
        if (presignRes.status < 500) {
          err.userMessage = friendlyClientErrorMessage(
            presignRes.status,
            errBody?.error?.code,
            errBody?.error?.message,
          );
        }
        throw err;
      }
      const body = await presignRes.json();
      const uploadUrl = body.uploadUrl;
      const r2Key = body.r2Key;

      const putRes = await fetchWithTimeout(
        uploadUrl,
        {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        },
        UPLOAD_TIMEOUT_MS,
      );
      if (!putRes.ok) throw new Error('upload failed');
      return r2Key;
    }

    async function createJob(customerPhotoKey) {
      // Whether this request carries a shopper-supplied address, which decides
      // whether a VALIDATION refusal below can be attributed to it.
      const sentEmail = !!(emailConfirmedByShopper && shopperEmail);
      let res;
      try {
        res = await fetchWithTimeout(
          `${PROXY_BASE}/customer/jobs`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              shopifyProductId: productId,
              customerPhotoKey: customerPhotoKey,
              clientId,
              ...(shopifyCustomerId ? { shopifyCustomerId } : {}),
              // Gated on the shopper having submitted the email step, not merely on
              // having an address: `shopperEmail` is prefilled from Liquid for any
              // logged-in customer, so keying off it captured their address on the
              // very first try-on without ever showing them the consent checkbox.
              ...(sentEmail ? { email: shopperEmail, emailConsent: shopperEmailConsent } : {}),
            }),
          },
          CREATE_JOB_TIMEOUT_MS,
        );
      } catch (err) {
        // This is the charging call, and a timeout is genuinely ambiguous: the
        // request may have reached the API, deducted a credit and queued the
        // job before the connection died. Nothing here can tell. So the copy
        // deliberately does NOT say "you haven't been charged" — unlike
        // ENQUEUE_FAIL below, where the server refunds in the same transaction
        // and the claim is true — and it steers away from an immediate retry
        // that could pay for the same try-on twice.
        if (err?.timedOut) {
          err.userMessage =
            "We couldn't confirm your try-on started. Please wait a moment before trying again.";
        }
        throw err;
      }
      if (res.status === 402) {
        showErrorWithMessage('Try-on is temporarily unavailable, please check back later.');
        throw new Error('try-on unavailable');
      }
      if (res.status === 403) {
        // Two different 403s reach here and they need opposite handling, so the
        // code — not the status — decides. FORBIDDEN means this upload is gone
        // (its 600s ownership record lapsed), and forgetting the remembered
        // photo is the correct, self-healing response. ORIGIN_NOT_ALLOWED means
        // the store's allowlist doesn't cover this storefront, where forgetting
        // the photo fixes nothing and re-uploading hits the identical wall.
        const errBody = await res.json().catch(() => ({}));
        if (errBody?.error?.code === 'ORIGIN_NOT_ALLOWED') {
          const err = new Error('origin not allowed');
          err.userMessage = friendlyClientErrorMessage(403, 'ORIGIN_NOT_ALLOWED');
          throw err;
        }
        const err = new Error('upload session expired or not owned');
        err.expiredReuse = true;
        throw err;
      }
      // A 401 needs no branch of its own: it falls through to the generic !res.ok
      // handler below, which maps it through friendlyClientErrorMessage. Only
      // 403 needs intercepting here, because expiredReuse short-circuits it.
      if (res.status === 202) {
        const body = await res.json().catch(() => ({}));
        return { pending: true, reason: body.reason, message: body.message };
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const code = errBody?.error?.code;
        const err = new Error(`job create failed: ${res.status}`);
        if (code === 'ENQUEUE_FAIL') {
          // The queue was unavailable after credits were already deducted —
          // the backend refunds them in the same transaction, so say so
          // rather than the generic "different photo" copy, which is the
          // wrong suggestion for an infra outage.
          err.userMessage =
            "We're experiencing high demand right now. You haven't been charged — please try again in a moment.";
        } else if (code === 'VALIDATION' && sentEmail) {
          // The address is the only free-text field the shopper contributes,
          // and EMAIL_RE is only a mirror of the server's rule, not the rule
          // itself — so the two can still disagree. The flag routes them back
          // to the email step (see returnToEmailStep); the message is the
          // fallback for when the modal is shut and there is no field to
          // return them to. Either way it must not be the photo copy.
          err.emailRejected = true;
          err.userMessage = "That email address wasn't accepted. Please check it and try again.";
        } else if (res.status < 500) {
          // Same as uploadPhoto: never show the backend's own AppError/Zod
          // text verbatim, only map its status/code to fixed friendly copy
          // (with the one deliberate exception inside
          // friendlyClientErrorMessage itself, for a 413).
          err.userMessage = friendlyClientErrorMessage(res.status, code, errBody?.error?.message);
        }
        throw err;
      }
      const body = await res.json();
      return { pending: false, jobId: body.jobId };
    }

    async function fetchJobStatus(jobId) {
      const res = await fetchWithTimeout(
        `${PROXY_BASE}/customer/jobs/${jobId}`,
        {},
        REQUEST_TIMEOUT_MS,
      );
      if (!res.ok) {
        const err = new Error(`job fetch failed: ${res.status}`);
        // Carried so pollJobStatus can tell an answer apart from a non-answer.
        err.status = res.status;
        throw err;
      }
      return res.json();
    }

    /**
     * fetchJobStatus, but a transient failure yields null instead of throwing.
     *
     * The status request is not the job. A rejected fetch, a timeout or a 5xx
     * says this one request didn't get through — it says nothing about the
     * generation, which is running on the server either way and which the store
     * has already been charged for. Letting such a blip escape used to abort
     * the whole wait and tell the shopper to try a different photo, discarding
     * a try-on that was often already finished.
     *
     * A 404 is the one authoritative answer: no such job for this store, and no
     * amount of retrying changes it. That still throws.
     */
    async function pollJobStatus(jobId) {
      for (let attempt = 0; attempt < STATUS_RETRY_ATTEMPTS; attempt++) {
        try {
          return await fetchJobStatus(jobId);
        } catch (err) {
          if (err?.status === 404) throw err;
          if (attempt === STATUS_RETRY_ATTEMPTS - 1) {
            console.warn('[aivastra tryon] job status unavailable, will retry', err);
            return null;
          }
          await delay(STATUS_RETRY_BASE_DELAY_MS * (attempt + 1));
        }
      }
      return null;
    }

    // Terminal job states, raised as tagged errors so proceedWithPhoto's catch
    // can pick the right copy for each. Shared by the SSE branch and the
    // polling fallback, which must agree on how a terminal state is reported.
    function terminalJobError(status, errorCode) {
      if (status === 'CANCELLED') {
        const err = new Error(errorCode || 'job cancelled');
        err.jobCancelled = true;
        return err;
      }
      const err = new Error(errorCode || 'job failed');
      err.jobFailed = true;
      return err;
    }

    /**
     * A COMPLETED job whose stored result is gone.
     *
     * Practically unreachable — the dispatcher writes job_outputs before it
     * transitions to COMPLETED — but reachable in principle once retention or a
     * GDPR erasure has removed the object. Deliberately NOT the jobFailed copy,
     * which promises a refund that did not happen here: the generation
     * succeeded and was charged for.
     */
    function missingResultError() {
      const err = new Error('completed job has no stored result');
      err.userMessage =
        "Your try-on finished, but we couldn't load the image. Please contact the store if this keeps happening.";
      return err;
    }

    async function waitForResult(jobId) {
      const deadline = Date.now() + SSE_MAX_WAIT_MS;

      while (Date.now() < deadline) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => {
            controller.abort();
          },
          Math.max(deadline - Date.now(), 0),
        );
        let terminal = null;

        try {
          const res = await fetch(`${apiBase}/v1/shopify/customer/jobs/${jobId}/events`, {
            headers: { 'x-widget-key': widgetKey },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`sse failed: ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (!terminal) {
            const readResult = await reader.read();
            if (readResult.done) break;
            buf += decoder.decode(readResult.value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (let i = 0; i < parts.length; i++) {
              let dataLine = '';
              const lines = parts[i].split('\n');
              for (let j = 0; j < lines.length; j++) {
                if (lines[j].indexOf('data:') === 0) dataLine = lines[j].slice(5).trim();
              }
              if (!dataLine) continue;
              try {
                const evt = JSON.parse(dataLine);
                // CANCELLED is terminal too — an admin can cancel a job
                // mid-flight. Without it here the connection just sits on its
                // 15s heartbeats until the full SSE_MAX_WAIT_MS deadline, and
                // the shopper waits six minutes to be told something vague.
                if (
                  evt.status === 'COMPLETED' ||
                  evt.status === 'FAILED' ||
                  evt.status === 'CANCELLED'
                ) {
                  terminal = evt;
                  break;
                }
              } catch (_e) {
                /* ignore malformed event */
              }
            }
          }
          reader.cancel().catch(() => {});
        } catch (_err) {
          if (controller.signal.aborted) throw new Error('sse timed out');
        } finally {
          clearTimeout(timer);
        }

        if (terminal) {
          if (terminal.status === 'CANCELLED' || terminal.status === 'FAILED') {
            throw terminalJobError(terminal.status, terminal.errorCode);
          }
          // COMPLETED. The image exists and the store has been charged for it,
          // so a status request that doesn't come back is not a reason to give
          // up on it — fall through to the outer loop and ask again until the
          // deadline. Only an answer ends the wait.
          const terminalBody = await pollJobStatus(jobId);
          if (terminalBody) {
            if (terminalBody.resultUrl) return terminalBody.resultUrl;
            throw missingResultError();
          }
        } else {
          const body = await pollJobStatus(jobId);
          if (body) {
            if (body.status === 'COMPLETED') {
              if (body.resultUrl) return body.resultUrl;
              throw missingResultError();
            }
            if (body.status === 'CANCELLED' || body.status === 'FAILED') {
              throw terminalJobError(body.status, body.errorCode);
            }
          }
        }

        await delay(SSE_RECONNECT_DELAY_MS);
      }
      throw new Error('sse timed out');
    }

    async function proceedWithPhoto(customerPhotoKey, isReuse) {
      try {
        rememberPhoto(customerPhotoKey);
        const jobResult = await createJob(customerPhotoKey);
        if (jobResult.pending) {
          if (jobResult.reason === 'email_required') {
            // Hold the photo key: the retry reuses the same upload (its Redis
            // ownership record lives 600s), so nothing is re-uploaded.
            awaitingEmailForPhotoKey = customerPhotoKey;
            showStep('email');
            return;
          }
          if (jobResult.message) {
            const pendingStep = steps.pending;
            if (pendingStep) pendingStep.querySelector('p').textContent = jobResult.message;
          }
          showStep('pending');
          return;
        }
        const resultUrl = await waitForResult(jobResult.jobId);
        // Recorded unconditionally — the generation happened and was paid
        // for, so it belongs in history however the shopper is currently
        // using the modal. This also refreshes the history badge, which is
        // what tells them a new result arrived when we don't navigate.
        addToHistory(resultUrl, jobResult.jobId);
        const entry = { resultUrl, jobId: jobResult.jobId };
        if (modal.hidden) {
          // Held rather than rendered — see pendingResultView.
          pendingResultView = entry;
        } else if (isAwaitingGeneration()) {
          resultBackTarget = 'flow';
          renderSingleResult(entry);
          showStep('result');
          trackEvent('result_view');
        }
      } catch (err) {
        // Failures are shown even if the shopper has navigated away, which is
        // the opposite of what the success path above does. The asymmetry is
        // deliberate: a finished try-on leaves an artifact they can find later
        // from the history badge, but a failure leaves nothing at all. Staying
        // quiet here would have them waiting on a result that is never coming,
        // with no way to discover why — worse than interrupting them.
        if (isReuse && err?.expiredReuse) {
          forgetPhoto();
          showStep('upload');
          if (reuseExpiredNote) reuseExpiredNote.hidden = false;
          return;
        }
        // The server rejected the address. Correcting it is something the
        // shopper can actually do, so send them back to the field holding the
        // same upload rather than to the error step, whose only exit is
        // startOver(). Skipped when the modal is shut — there is nobody to put
        // in front of the field, and the stashed message is the honest outcome.
        if (err?.emailRejected && !modal.hidden) {
          console.error('[aivastra tryon] email rejected by server', err);
          returnToEmailStep(customerPhotoKey, 'Enter a valid email address.');
          return;
        }
        // The raw reason (err.message on a jobFailed error is the
        // dispatcher's internal errorCode — provider/exception text, not
        // written for a shopper to read) stays in the console for debugging;
        // only a curated, safe message ever reaches the error step.
        console.error('[aivastra tryon] generation failed', err);
        if (err?.userMessage) {
          showErrorWithMessage(err.userMessage);
        } else if (err?.jobCancelled) {
          // Deliberately not the jobFailed copy: nothing was wrong with their
          // photo, so telling them to retake it sends them fixing a problem
          // that doesn't exist.
          showErrorWithMessage(
            'This try-on was cancelled before it finished. Please try again in a moment.',
          );
        } else if (err?.jobFailed) {
          showErrorWithMessage(
            "We couldn't generate your try-on and your credits were refunded. Try a clear, front-facing photo with good lighting.",
          );
        } else if (err && err.message === 'sse timed out') {
          showErrorWithMessage(
            'This is taking longer than expected. Please try again in a moment.',
          );
        } else {
          // Last resort: an unrecognized failure with no curated message of
          // its own. A merchant who explicitly set their own errorText sees
          // that instead of this default — see merchantErrorText above.
          showErrorWithMessage(
            merchantErrorText ||
              "We couldn't generate your try-on. Please try again with a different photo.",
          );
        }
      }
    }

    // Fires from the "Try It On Now" CTA on the ready step — the photo was
    // already picked (new upload or reuse) and is just waiting for the
    // shopper to confirm before spending a generation.
    async function confirmReady() {
      // Second click while the first generation is still running — already
      // queued, already charged. Nulling pendingFile below only guards a
      // double-tap inside one modal session; reopening the modal repopulates
      // it, which is exactly how the duplicate charge used to happen.
      if (generationInFlight) return;
      const file = pendingFile;
      const reuseKey = pendingReuseKey;
      pendingFile = null;
      pendingReuseKey = null;
      // readyImage.src is already the current photo (blob URL for a fresh
      // upload, presigned preview URL for a reuse) regardless of which
      // branch below runs, so grab it once before either path proceeds.
      setProgressBackground(readyImage ? readyImage.src : null);
      // Same photo, same box-sizing approach as the ready step — otherwise
      // the canvas stays at a flat 3:4 while the modal (now --fit here too)
      // sizes around it, leaving empty space for any other aspect ratio.
      if (readyImage) fitToPhotoAspectRatio(progressCanvas, readyImage);
      if (file) {
        showStep('progress');
        generationInFlight = true;
        try {
          const customerPhotoKey = await uploadPhoto(file);
          await proceedWithPhoto(customerPhotoKey, false);
        } catch (err) {
          console.error('[aivastra tryon] upload failed', err);
          if (err?.userMessage) {
            showErrorWithMessage(err.userMessage);
          } else {
            showErrorWithMessage(
              "We couldn't upload your photo. Please check your connection and try again.",
            );
          }
        } finally {
          // In `finally` so a failed upload — which never reached the API and
          // so was never charged — releases the CTA for a genuine retry.
          generationInFlight = false;
        }
      } else if (reuseKey) {
        showStep('progress');
        generationInFlight = true;
        try {
          await proceedWithPhoto(reuseKey, true);
        } finally {
          generationInFlight = false;
        }
      }
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
    if (lightbox) {
      // Tapping the dark backdrop closes it; tapping the image itself
      // (or the close button) must not, so only a direct hit on the
      // lightbox element itself counts.
      lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox && !lightbox.hidden) closeLightbox();
    });
    // Both handlers are async, so a throw inside one would otherwise surface
    // as an unhandled rejection and the button would simply look dead. Their
    // internals are individually guarded, so this is a backstop rather than a
    // known failure — but a silent no-op button is the one outcome a shopper
    // can neither understand nor recover from.
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        void handleBack().catch((err) => console.error('[aivastra tryon] back failed', err));
      });
    }
    if (ctaBtn) {
      ctaBtn.addEventListener('click', () => {
        void confirmReady().catch((err) => console.error('[aivastra tryon] try-on failed', err));
      });
    }
    if (changePhotoBtn) changePhotoBtn.addEventListener('click', () => fileInput.click());
    if (historyBtn) {
      historyBtn.addEventListener('click', async () => {
        // Opened from a single card (fresh generation or a tile detail)?
        // Remember it — and what its own back target was — so backBtn pops
        // the grid back to that exact card instead of always leaving via
        // startOver().
        const onResultView = steps.result ? !steps.result.hidden : false;
        const onGrid = onResultView && !!resultList?.classList.contains(RESULT_LIST_GRID_CLASS);
        if (onResultView && !onGrid && currentResultEntry) {
          historyReturn = { backTarget: resultBackTarget, entry: currentResultEntry };
          resultBackTarget = 'entry';
        } else {
          historyReturn = null;
          resultBackTarget = 'flow';
        }
        try {
          await renderResultList();
          showStep('result');
        } catch (err) {
          console.error('[aivastra tryon] could not open history', err);
        }
      });
    }
    syncHeaderButton();
    function handlePickedFile(input) {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showErrorWithMessage('Please choose an image file.');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        showErrorWithMessage('That photo is too large. Please choose one under 25MB.');
        return;
      }
      showReady({ file });
    }
    fileInput.addEventListener('change', () => handlePickedFile(fileInput));
    const retryBtns = modal.querySelectorAll('.aivastra-tryon__retry');
    for (let k = 0; k < retryBtns.length; k++) {
      retryBtns[k].addEventListener('click', startOver);
    }
  }

  // No placement step: the merchant positioned this block in the theme editor,
  // so it already renders where it belongs.
  const widgets = document.querySelectorAll('.aivastra-tryon');
  for (let i = 0; i < widgets.length; i++) {
    // Contained per widget. initWidget reads a good deal of merchant-controlled
    // markup, and a theme that strips or renames one element used to throw out
    // of the whole loop — so one broken block on a page took every other block
    // down with it. A failure here still leaves that block's button inert
    // (nothing is attached yet), but it is now loud in the console and its
    // neighbours survive.
    try {
      initWidget(widgets[i]);
    } catch (err) {
      console.error('[aivastra tryon] widget failed to initialize', err);
    }
  }
})();
