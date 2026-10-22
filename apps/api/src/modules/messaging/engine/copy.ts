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
  menu: 'What would you like to do?',
  btnNewCatalog: 'New catalog',
  btnCredits: 'Credits',
  btnHelp: 'Help',
  btnMenu: 'Menu',
  btnMore: 'More',
  btnStartOver: 'Start over',
  btnMorePoses: 'More poses',
  btnRetryFailed: 'Retry failed',
  btnSelect: 'Select',
  btnChangeGarment: 'Change garment',
  btnGenerate: 'Generate',
  btnClear: 'Clear',
  listChoose: 'Choose',
  moreOptions: 'More options:',

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
  kindGuess: (kind: string) => {
    const name = kind.trim().toLowerCase();
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
  pickPrompt: (perImage: number, balance: number) =>
    `Pick the poses you want. Each one is ${perImage} credits. Your balance: ${balance} credits.`,
  pickCards: 'Tap a pose to select it. Tap it again to remove it.',
  pickFooter: 'Select poses above, then tap Generate.',
  selected: (n: number, credits: number) => `${n} selected · ${credits} credits`,
  pickAtLeastOne: 'Tap at least one pose first.',
  pickCap: (max: number) => `You can generate up to ${max} poses at a time.`,
  partlyStarted: (started: number, total: number, reason: string) =>
    `Started ${started} of ${total} ${total === 1 ? 'image' : 'images'}. The rest couldn't start: ${reason}`,
  noCredits: (pricing: string) =>
    `You don't have enough credits for this. Buy more on the website, then come back: ${pricing}`,
  creditsAdded: (n: number) => `${n} credits added.`,
  generating: (n: number, credits: number) =>
    `Working on ${n} ${n === 1 ? 'image' : 'images'}, ${credits} credits. I'll send each one here as it's ready.`,
  stillGenerating: (finished: number, total: number) =>
    `Still generating: ${finished} of ${total} done.`,
  delivered: 'All done. What next?',
  partlyFailed: (failed: number, total: number) =>
    `${failed} of ${total} ${total === 1 ? 'image' : 'images'} failed. The credits for ${failed === 1 ? 'it were' : 'them were'} refunded.`,
  posesChanged: 'Those poses changed. Please choose again.',

  stale: 'That option is from an earlier step.',
  sessionExpired: "Your last session expired, let's start again.",
  reprompt: 'Please use the options above, or type MENU.',
  notNow: "I wasn't expecting a photo just now.",
  unsupported: 'Please send a photo (JPG or PNG), not a video or document.',
  nothingAvailable: 'Nothing is available for that choice right now.',

  connectPrompt: (url: string) =>
    `Welcome to Aivastra! To create catalog images here, connect your Aivastra account (or create one): ${url}\nThis link works for 30 minutes.`,
  connected:
    'Connected. You can now create catalog images here. Reply STOP at any time to stop messages from Aivastra, or MENU to see your options.',
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
