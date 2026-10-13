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
  detected: (label: string) => `Detected: ${label}.`,
  notAvailable: (label: string, studio: string) =>
    `${label} catalogs aren't available on WhatsApp yet. You can create one in the web studio: ${studio}`,
  askPhoto: {
    lowerFront: (label: string | null) => `Now send a photo of the ${label ?? 'lower garment'}.`,
    third: (label: string | null) => `Now send a photo of the ${label ?? 'third garment'}.`,
  },
  askCount: (balance: number) => `How many poses do you want? Your balance: ${balance} credits.`,
  // At most "9 poses · 999 credits" (21 characters).
  countRow: (n: number, credits: number) =>
    `${n} ${n === 1 ? 'pose' : 'poses'} · ${credits} credits`,
  rowChangeGarment: 'Wrong garment? Change',
  pickLooks: (count: number) =>
    `Tap ${count} ${count === 1 ? 'pose' : 'poses'}. Generation starts after the last one.`,
  lookAdded: (k: number, n: number) => `Added, ${k} of ${n}.`,
  lookAlreadyAdded: 'That pose is already added.',
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
} as const;
