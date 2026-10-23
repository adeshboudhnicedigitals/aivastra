// Every user-visible string the bot sends (D8: English only, one file).

// Admin writes these labels for the web studio's upload boxes ("Upload Pyjama");
// mid-sentence in chat they read as "the pyjama".
function photoName(label: string | null): string | null {
  const name = label
    ?.replace(/^upload\s+/i, '')
    .trim()
    .toLowerCase();
  return name || null;
}

function askMain(main: string | null): string {
  const name = photoName(main);
  return name ? `I'll use the photo you sent as the ${name}. ` : '';
}

// Button titles are capped at 20 characters by WhatsApp; list row titles at 24.
export const COPY = {
  menu: '✨ Ai Vastra\nWhat would you like to do?',
  btnNewCatalog: 'New catalog',
  // Menu-only titles carry the emoji; btnNewCatalog stays plain because the
  // delivery buttons share it.
  btnMenuNew: '📸 New catalogue',
  btnCredits: '💳 My credits',
  btnHelp: '💬 Help',
  btnMenu: 'Menu',
  btnMore: 'More',
  btnStartOver: 'Start over',
  btnMorePoses: 'More poses',
  btnRetryFailed: 'Retry failed',
  btnChangeGarment: 'Change garment',
  btnSelect: 'Select',
  listChoose: 'Choose',

  credits: (balance: number, pricing: string) =>
    `You have ${balance} credits. Buy more on the website: ${pricing}`,
  help: (help: string) =>
    `Send a photo of your garment to start a catalog, or type MENU at any time. Need a person? ${help}`,

  askGarmentPhoto: 'Send a photo of your garment, laid flat and fully visible.',
  askGender: 'Create this catalogue for:',
  // After "Yes, continue" the confirmation is acknowledged first (Flow 2).
  askGenderConfirmed: 'Great! 👍\nCreate this catalogue for:',
  btnYesContinue: 'Yes, continue',
  btnNoDifferent: 'No, different item',
  // `gender` is given when the kind implies it, so the seller can catch a wrong one here.
  kindGuess: (kind: string, gender?: string) => {
    const name = `${gender ? `${gender.toLowerCase()}'s ` : ''}${kind.trim().toLowerCase()}`;
    return `I've analysed the image and it looks like ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}.\nIs this correct?`;
  },
  genders: { women: 'Women', men: 'Men', boys: 'Boys', girls: 'Girls' } as const,
  askGarmentType: 'Which garment is it?',
  // The draft link carries the photo once the studio page reads `?draft=`, so
  // until then this wording must not claim the photo is saved. `offerList` is
  // false when there is no type list to follow, so the text does not point at one.
  handoff: (label: string, url: string, offerList = true) =>
    `${label} catalogs can't be made on WhatsApp yet. You can create one in the web studio: ${url}${
      offerList ? '\n\nOr choose another type.' : ''
    }`,
  // `main` names what the first photo is taken as, so a seller sending a set
  // knows the order matters. Only said before the first extra photo.
  askPhoto: {
    lowerFront: (label: string | null, main: string | null) =>
      `${askMain(main)}Now send a photo of the ${photoName(label) ?? 'lower garment'}.`,
    third: (label: string | null, main: string | null) =>
      `${askMain(main)}Now send a photo of the ${photoName(label) ?? 'third garment'}.`,
  },
  countPrompt: (category: string, garment: string, perImage: number, balance: number) =>
    `Great! Let's create your catalogue. ✨
Category: ${category}
Garment: ${garment}

Credits per pose: ${perImage} credits
Available balance: ${balance} credits

How many poses would you like to generate for your catalogue?
You can choose one option below. Each pose will use ${perImage} credits.`,
  countOption: (n: number, credits: number) =>
    `${n} ${n === 1 ? 'pose' : 'poses'} (${credits} credits)`,
  partlyStarted: (started: number, total: number, reason: string) =>
    `Started ${started} of ${total} ${total === 1 ? 'image' : 'images'}. The rest couldn't start: ${reason}`,
  noCredits: (pricing: string) =>
    `You don't have enough credits for this. Buy more on the website, then come back: ${pricing}`,
  creditsAdded: (n: number) => `${n} credits added.`,
  generating: (n: number) =>
    `Generating your ${n} ${n === 1 ? 'pose' : 'poses'}...
We're creating your catalogue images.
This may take a few seconds.`,
  stillGenerating: (finished: number, total: number) =>
    `Still generating: ${finished} of ${total} done.`,
  deliveredSummary: (
    n: number,
    category: string,
    garment: string,
    used: number,
    remaining: number,
  ) =>
    `Here are your ${n} generated ${n === 1 ? 'pose' : 'poses'}!\nCategory: ${category} | Garment: ${garment}\nCredits used: ${used} credits\nRemaining balance: ${remaining} credits`,
  deliveredNext: 'What would you like to do next?',

  // Try-on flow (spec 2026-10-22-whatsapp-tryon-flow-design).
  tryonCountPrompt: (category: string, perImage: number, balance: number) =>
    `Great! Let's create your catalogue. ✨
Category: ${category}

Credits per pose: ${perImage} credits
Available balance: ${balance} credits

How many poses would you like?
Tapping an option starts generating right away.`,
  tryonNoPoses:
    "We don't have poses ready for that category on WhatsApp yet. Please choose another.",
  tryonDelivered: (n: number, category: string, used: number, remaining: number) =>
    `Here are your ${n} generated ${n === 1 ? 'pose' : 'poses'}!\nCategory: ${category}\nCredits used: ${used} credits\nRemaining balance: ${remaining} credits`,
  btnMakeMore: 'Make more',
  btnNewGarment: 'New garment',

  partlyFailed: (failed: number, total: number) =>
    `${failed} of ${total} ${total === 1 ? 'image' : 'images'} failed. The credits for ${failed === 1 ? 'it were' : 'them were'} refunded.`,
  posesChanged: 'Those poses changed. Please choose again.',

  stale: 'That option is from an earlier step.',
  sessionExpired: "Your last session expired, let's start again.",
  reprompt: 'Please use the options above, or type MENU.',
  notNow: "I wasn't expecting a photo just now.",
  unsupported: 'Please send a photo (JPG or PNG), not a video or document.',
  nothingAvailable: 'Nothing is available for that choice right now.',

  connectPrompt: [
    'Welcome to Ai Vastra! 👋',
    'Create professional fashion catalogue images from your garment photos.',
    '',
    '📸 AI model photos',
    '🚫 No studio, no shoot day',
    '⚡ Ready in minutes',
    '',
    'To get started, connect your Ai Vastra account (or create one).',
  ].join('\n'),
  btnConnect: 'Connect my account',
  connectFooter: 'The link expires in 30 minutes.',
  connected: [
    "You're all set! ✅",
    'Your WhatsApp is now connected to your Ai Vastra account.',
    '',
    'Send a garment photo whenever you are ready and I will turn it into catalogue images. 📸',
    '',
    'Reply MENU to see your options, or STOP to pause messages.',
  ].join('\n'),
  connectedDifferentNumber: (last4: string) =>
    `Note: this WhatsApp number is different from the mobile number on your account (ending ${last4}).`,
  alreadyConnected: 'This number is already connected to your Aivastra account.',
  connectCodeInvalid:
    'That code has expired or was already used. Open Settings on the Aivastra website and tap Connect WhatsApp again.',
  numberInUse: 'This number is connected to another Aivastra account. Disconnect it there first.',
  stopped:
    "You won't receive any more messages from Aivastra on WhatsApp. Your account and images are unchanged. Send START if you want to use the bot again.",
  photoFailed: "Couldn't receive that photo. Please send it again.",
} as const;
