// Every user-visible string the bot sends (D8: English only, one file).
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
  askGender: 'Create catalogue for:',
  genders: { women: 'Women', men: 'Men', boys: 'Boys', girls: 'Girls' } as const,
  askGarmentType: 'Which garment is it?',
  confirmGarment: (label: string) => `Looks like: ${label}. Is that right?`,
  btnYes: 'Yes',
  btnNo: 'No, change',
  notAvailable: (label: string, studio: string) =>
    `${label} catalogs aren't available on WhatsApp yet. You can create one in the web studio: ${studio}`,
  askPhoto: {
    lowerFront: (label: string | null) => `Now send a photo of the ${label ?? 'lower garment'}.`,
    third: (label: string | null) => `Now send a photo of the ${label ?? 'third garment'}.`,
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
