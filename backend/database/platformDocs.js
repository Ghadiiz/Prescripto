// THE RAG CORPUS — platform and how-it-works prose.
//
// This file is the SOURCE OF TRUTH for what `platform_docs` contains. The
// ingestion script (`npm run ingest:docs`) makes the table match it: passages
// here are inserted or updated, and rows whose slug has been REMOVED from here
// are deleted. Edit the prose, re-run the script, done.
//
//
// WHAT BELONGS HERE, AND WHAT MUST NOT
//
// Only UNSTRUCTURED prose — explanations with no SQL answer. How booking
// works, how the waitlist works, what the assistant can and cannot do, policy.
//
// NOT per-doctor facts. Fees, hours, specialities, locations and availability
// are STRUCTURED data, already served exactly and live by `search_doctors`,
// `get_doctor` and `check_availability`. Embedding them would bury computable
// rows in a vector index, where they go stale the moment a doctor edits a fee
// and where "is Dr. Smith free Tuesday?" becomes a similarity search instead of
// a query with one correct answer. That is the anti-pattern Phase 8 exists to
// demonstrate against, and adding "just one" doctor passage here is how it
// would arrive.
//
//
// THESE ARE DOCUMENTATION, NOT INSTRUCTIONS
//
// The assistant RETRIEVES and RELAYS these passages; it does not obey them.
// Rule 5 applies to a retrieved passage exactly as it applies to a doctor's
// profile text: it is DATA. Do not write "always tell the patient..." or
// "never mention..." here — that is what the system prompt is for, and
// duplicating it would create a second source of truth for behaviour AND hand
// anyone who edits this file a channel into the instruction stream.
//
// Write for the PATIENT, in the second person, as help-centre copy.
//
//
// AUTHORING
//
// The prose is Ghadi's, written against the app as it actually behaves and
// checked against it — date of birth is genuinely required to book, cancelling
// genuinely asks for a reason, verification is genuinely a link. Claude Code
// scaffolded only the slugs and titles. Rename, merge, split or delete any
// entry; nothing depends on this particular list.
//
// The ingestion script REFUSES to run while any `content` is empty and names
// the slugs, so a half-written corpus cannot reach the table.
//
// Notes for editing, and for anything added later:
//   - One idea per passage. Retrieval returns whole passages, so a passage
//     covering three topics answers a question about one of them with two
//     paragraphs of noise attached.
//   - A few sentences to a short paragraph each. These are embedded as one
//     unit; a long passage blurs into an average of everything it says.
//   - The TITLE is embedded along with the content, so it does real work —
//     write it as the question a patient would ask, not as a filing label.
//   - Say what is true of the system as built. A passage that describes a
//     feature aspirationally is a passage that lies to a patient.

const platformDocs = [
  // --- booking -------------------------------------------------------------
  {
    slug: 'booking-how-it-works',
    title: 'How do I book an appointment?',
    source: null,
    content: `You can search and browse doctors through the all doctors page, where you will find every doctor along with a search bar and the option to filter doctors by speciality. Once you find a doctor, click on them to open their booking page and select an available day and time that suits you. You need to be logged in with a verified account and have added your date of birth in the profile section, as these are required to book an appointment. Once you have booked, you will be taken to the appointments page where you can see the details of your appointment and cancel it if you need to. There is also an AI assistant that can help you, but it cannot book an appointment for you.`,
  },
  {
    slug: 'booking-choosing-a-doctor',
    title: 'How do I find the right doctor?',
    source: null,
    content: `You can browse through all doctors and filter by speciality. There is also an AI assistant that can help you search and filter, but it cannot recommend a doctor for you based on your medical condition.`,
  },
  {
    slug: 'booking-how-far-ahead',
    title: 'How far ahead can I book?',
    source: null,
    content: `You can book an appointment up to 30 days in advance.`,
  },

  // --- changing an appointment ---------------------------------------------
  {
    slug: 'appointments-cancelling',
    title: 'How do I cancel an appointment?',
    source: null,
    content: `You can cancel an appointment from the appointments page under the profile section, where you will find your upcoming appointments with a cancel button next to each one. You will be asked to provide a reason for cancelling.`,
  },
  {
    slug: 'appointments-rescheduling',
    title: 'How do I change or reschedule an appointment?',
    source: null,
    content: `There isn't a separate reschedule option. To change an appointment to a different time, cancel your current one and then book the new slot you want. Both steps happen in the app.`,
  },

  // --- the waitlist --------------------------------------------------------
  {
    slug: 'waitlist-what-it-is',
    title: 'What is the waitlist and how does it work?',
    source: null,
    content: `The waitlist is for when a doctor's slot you want is already taken. You can join the waitlist by asking the AI assistant to add you to it for a specific slot, and if that slot frees up — for example, if someone cancels their appointment — you will receive a notification inside the app letting you know the slot is free. You can click the notification to be taken to that slot so you can book it. The notification is only there to let you know the slot has opened; it does not guarantee you will be able to book it, as someone else might book it before you do.`,
  },
  {
    slug: 'waitlist-one-slot-at-a-time',
    title: 'Can I join the waitlist for a whole week, or several times?',
    source: null,
    content: `You can only join the waitlist for one specific slot at a time. If you want to be on the waitlist for more than one slot, you would need to join for each one individually. You also cannot join the waitlist for a day on which you already have an appointment booked with the same doctor; if you would prefer a different time, you will need to cancel your current appointment first and then join the waitlist for the slot you want.`,
  },
  {
    slug: 'waitlist-notifications',
    title: 'What happens when a slot I am waiting for opens up?',
    source: null,
    content: `When a slot you are waiting for opens up, you will receive a notification inside the app. You can then click the notification to be taken to that slot so you can book it. However, this notification does not guarantee that you will be able to book the slot, as someone else might book it before you do.`,
  },

  // --- the assistant -------------------------------------------------------
  {
    slug: 'assistant-what-it-can-do',
    title: 'What can the AI assistant do for me?',
    source: null,
    content: `The assistant can help you search for doctors, filter by speciality and area, tell you about a doctor, and check availability. It can also add you to the waitlist for a specific slot, and it can answer questions about how booking works and give you information about your own appointments.`,
  },
  {
    slug: 'assistant-what-it-cannot-do',
    title: 'Why can the assistant not book or cancel for me?',
    source: null,
    content: `The assistant cannot book or cancel appointments for you — those are actions you take yourself in the app. Keeping them in your hands means these changes to your appointments are always your own deliberate choice. The assistant also never has access to your password and cannot make any destructive changes to your account.`,
  },

  // --- policy --------------------------------------------------------------
  {
    slug: 'policy-privacy-and-data',
    title: 'What do you do with my personal information?',
    source: null,
    content: `Your personal information is used to run your account and your appointments — details such as your name, contact information, and the appointments you book. Your information is only visible to you and to the doctors involved in your care; other patients cannot see your appointments or details, and the AI assistant only ever has access to your own information, never anyone else's. Please note that this is a portfolio demonstration project, so you should avoid entering any real sensitive personal or medical information.`,
  },
  {
    slug: 'policy-accounts-and-verification',
    title: 'Why do I need to verify my email address?',
    source: null,
    content: `Verifying your email confirms that the account belongs to you before you can book appointments. It also keeps your appointments tied to a real, reachable address, so that booking confirmations and waitlist notifications can reach you. You verify by clicking the link sent to your email address when you register.`,
  },
];

export { platformDocs };
