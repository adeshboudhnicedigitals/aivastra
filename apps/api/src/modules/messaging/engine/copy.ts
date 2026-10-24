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
  menu: '✨ Ai Vastra',
  btnNewCatalog: 'New catalog',
  // Menu-only titles carry the emoji; btnNewCatalog stays plain because the
  // delivery buttons share it.
  btnMenuNew: '📸 New catalogue',
  btnCredits: '💳 My credits',
  btnHelp: '💬 Help',
  btnMenu: 'Menu',
  btnBack: 'Back',
  btnMore: 'More',
  btnMorePoses: 'More poses',
  btnRetryFailed: 'Retry failed',
  btnSelect: 'Select',
  listChoose: 'Choose',

  credits: (balance: number, pricing: string) =>
    `You have ${balance} credits. Buy more on the website: ${pricing}`,
  help: (help: string) =>
    `Send a garment photo to start. Type MENU any time. Need a person? ${help}`,

  askGarmentPhoto: 'Send a photo of the garment, laid flat.',
  askGender: 'Who is it for?',
  askGenderConfirmed: 'Who is it for?',
  btnYesContinue: 'Yes, continue',
  btnNoDifferent: 'No, different item',
  // `gender` is given when the kind implies it, so the seller can catch a wrong one here.
  kindGuess: (kind: string, gender?: string) => {
    const name = `${gender ? `${gender.toLowerCase()}'s ` : ''}${kind.trim().toLowerCase()}`;
    return `Looks like ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}. Correct?`;
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
    `How many poses?\n${garment} · ${category}\n${perImage} credits each · Balance: ${balance}`,
  countOption: (n: number, credits: number) =>
    `${n} ${n === 1 ? 'pose' : 'poses'} (${credits} credits)`,
  noCredits: (pricing: string) => `Not enough credits. Top up: ${pricing}`,
  creditsAdded: (n: number) => `${n} credits added.`,
  generating: (n: number) => `Generating ${n} ${n === 1 ? 'pose' : 'poses'}… ⏳`,
  stillGenerating: (finished: number, total: number) =>
    `Still generating: ${finished} of ${total} done.`,
  deliveredNext: 'What would you like to do next?',

  // One closing message: what was delivered, what it cost, what was refunded.
  closing: (delivered: number, failed: number, perImage: number, remaining: number) => {
    const refunded = failed * perImage;
    if (delivered <= 0)
      return `Couldn't make your ${failed === 1 ? 'pose' : 'poses'} this time. Your ${refunded} credits were refunded. Try again?`;
    const done = `${delivered} ${delivered === 1 ? 'pose' : 'poses'} · ${delivered * perImage} credits used · ${remaining} left`;
    return failed > 0
      ? `${done}\n${failed} couldn't be made, so ${refunded} credits were refunded.`
      : done;
  },
  btnNewGarment: 'New garment',
  // Appended to the credits/help answer at the photo prompt so the seller keeps their place.
  thenPhoto: 'Send a garment photo to start.',

  posesChanged: 'Not available right now. Please pick again.',

  unsupported: 'Please send a photo (JPG or PNG), not a video or document.',
  nothingAvailable: 'Nothing is available for that choice right now.',

  connectPrompt:
    'Welcome to Ai Vastra 👋\nTurn a garment photo into model shots. Connect your account to start.',
  btnConnect: 'Connect my account',
  connectFooter: 'The link expires in 30 minutes.',
  connected: 'Connected ✅ Send a garment photo to start.',
  connectedDifferentNumber: (last4: string) =>
    `Note: this WhatsApp number is different from the mobile number on your account (ending ${last4}).`,
  connectCodeInvalid:
    'That code has expired or was already used. Open Settings on the Aivastra website and tap Connect WhatsApp again.',
  numberInUse: 'This number is connected to another Aivastra account. Disconnect it there first.',
  stopped: 'Paused. Send START to resume.',
  photoFailed: "Couldn't receive that photo. Please send it again.",
} as const;
