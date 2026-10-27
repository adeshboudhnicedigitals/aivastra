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
  btnMenuNew: 'New catalogue',
  btnCredits: 'Credits',
  btnHelp: 'Help',
  btnMenu: 'Menu',
  btnExit: 'Exit',
  btnMore: 'More',
  btnMorePoses: 'More poses',
  btnRetryFailed: 'Retry failed',
  btnSelect: 'Select',
  listChoose: 'Choose',

  credits: (balance: number, pricing: string) =>
    `You have ${balance} credits remaining. 💳\nBuy more on the website: ${pricing}`,
  help: (help: string) =>
    `Send a garment photo to start. Type MENU any time. Need a person? ${help}`,

  askGarmentPhoto: "Let's create your catalogue!✨\nUpload a clear photo of your garment.",
  askGender: 'Who is this catalogue for?',
  btnYesContinue: 'Yes, continue',
  btnNoDifferent: 'Choose garment type',
  // The basket name is admin-written ("Men lower", "Two piece"), so it is used as is.
  basketGuess: (name: string) => `This looks like ${name.trim().toLowerCase()}. Is that right?`,
  askBasket: 'No problem! Select the correct garment type.',
  basketOther: 'Something else',
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
  countPrompt: (perImage: number) =>
    `How many poses would you like?\nEach pose uses ${perImage} credits.`,
  countOption: (n: number, credits: number) =>
    `${n} ${n === 1 ? 'pose' : 'poses'} · ${credits} credits`,
  noCredits: (pricing: string) => `Not enough credits. Top up: ${pricing}`,
  creditsAdded: (n: number) => `${n} credits added.`,
  generating: (n: number) => `Creating your ${n} ${n === 1 ? 'pose' : 'poses'} now. ✨`,
  // A catalogue is being generated and the seller tried to start another.
  busyNew: (finished: number, total: number) =>
    `Your catalogue is still generating (${finished} of ${total} done). Please wait for it to finish.`,
  // Mid-catalogue, the seller sent a photo or tapped New catalogue.
  inFlow: "You're in the middle of a catalogue. Type MENU to start over.",
  stillGenerating: (finished: number, total: number) =>
    `Still generating: ${finished} of ${total} done.`,
  deliveredNext: 'What would you like to do next?',

  // One closing message: what was delivered, what it cost, what was refunded.
  closing: (delivered: number, failed: number, perImage: number) => {
    const refunded = failed * perImage;
    if (delivered <= 0)
      return `Couldn't make your ${failed === 1 ? 'pose' : 'poses'} this time. Your ${refunded} credits were refunded. Try again?`;
    const done = `Your ${delivered} ${delivered === 1 ? 'pose is' : 'poses are'} ready! 🎉`;
    const refund =
      failed > 0 ? `\n${failed} couldn't be made, so ${refunded} credits were refunded.` : '';
    return `${done}${refund}\nWhat would you like to do next?`;
  },
  btnNewGarment: 'New catalogue',
  // Appended to the credits/help answer at the photo prompt so the seller keeps their place.
  thenPhoto: 'Send a garment photo to start.',

  posesChanged: 'Not available right now. Please pick again.',

  unsupported: 'Please send a photo (JPG or PNG), not a video or document.',
  nothingAvailable: 'Nothing is available for that choice right now.',

  connectPrompt: 'Welcome to Ai Vastra! 👋\nCreate AI fashion catalogues right here on WhatsApp.',
  btnConnect: 'Connect my account',
  connectFooter: 'The link expires in 30 minutes.',
  connected: "You're connected! 🎉",
  connectedDifferentNumber: (last4: string) =>
    `Note: this WhatsApp number is different from the mobile number on your account (ending ${last4}).`,
  connectCodeInvalid:
    'That code has expired or was already used. Open Settings on the Aivastra website and tap Connect WhatsApp again.',
  numberInUse: 'This number is connected to another Aivastra account. Disconnect it there first.',
  stopped: 'Paused. Send START to resume.',
  photoFailed: "Couldn't receive that photo. Please send it again.",
} as const;
