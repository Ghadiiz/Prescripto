// Phrases that end the conversation with a fixed response.
//
// These live in CODE, not in a table, on purpose. `speciality_keywords` is
// admin-editable because getting it wrong routes someone to the wrong
// speciality. Getting this wrong means a real emergency is answered by a
// booking assistant. If it lived in the database, anyone with panel access —
// or anyone who compromised it — could empty the table and silently disable
// the check, and nothing would look broken.
//
// Phrasings here are deliberately ABSENT from speciality_keywords (see
// migration 002), so there is no path by which "chest pain" routes to a
// speciality instead of tripping this.
//
// Two categories, two responses. "Contact emergency services and go to A&E" is
// the right answer for a heart attack and the wrong answer for someone in a
// mental-health crisis, so the check selects between two fixed strings.
//
// Both lists are deliberately RECALL-favouring, the opposite of how
// speciality_keywords is tuned. There, precision matters: a confident wrong
// route misleads someone. Here, a false negative means a booking assistant
// answers a crisis — the catastrophic failure this guardrail exists to
// prevent — while a false positive costs one turn and is recoverable through
// the continuation offered in each response.
//
// So: every term gets its plausible inflections. Singular and plural, present
// and past tense, British and American spelling, and the contraction-stripped
// forms `normalise()` produces ("isn't" becomes "isnt", not "is not").

export const PHYSICAL_EMERGENCY_PHRASES = [
  // Cardiac
  'chest pain',
  'chest pains',
  'heart attack',
  'heart attacks',
  'cardiac arrest',
  'cardiac arrests',
  'crushing chest',

  // Breathing
  'cannot breathe',
  'can not breathe',
  'cant breathe',
  'trouble breathing',
  'difficulty breathing',
  'struggling to breathe',
  'stopped breathing',
  'not breathing',
  // "isn't breathing" normalises to "isnt breathing", which does NOT contain
  // the token pair "not breathing" — it needs its own entry.
  'isnt breathing',
  'choking',

  // Stroke
  'stroke',
  'strokes',
  'face drooping',
  'slurred speech',
  'sudden numbness',

  // Major trauma and bleeding
  'severe bleeding',
  'heavy bleeding',
  'bleeding badly',
  'wont stop bleeding',
  'will not stop bleeding',
  'broken bone sticking out',
  'broken bones sticking out',

  // Consciousness
  'unconscious',
  'unresponsive',
  'not responding',
  'isnt responding',
  'passed out',
  'passing out',
  'fainted and wont wake',
  'wont wake up',
  'will not wake up',

  // Neurological
  'seizure',
  'seizures',
  'seizing',
  'convulsing',
  'convulsions',
  'fitting',

  // Poisoning and allergy
  'overdose',
  'overdoses',
  'overdosed',
  'overdosing',
  'poisoned',
  // NOTE: also catches "food poisoning", which is often not an emergency.
  // Accepted knowingly: the continuation sentence lets them rephrase, and the
  // reverse error is far worse.
  'poisoning',
  'swallowed bleach',
  'anaphylaxis',
  'anaphylactic',
  'throat closing',
  'throat is closing',

  // Obstetric
  'water broke',
  'waters broke',
  'water breaking',
  'waters breaking',
  'in labour',
  'in labor',
];

export const SELF_HARM_PHRASES = [
  'kill myself',
  'killing myself',
  'end my life',
  'ending my life',
  'end it all',
  'want to die',
  'wanna die',
  'dont want to be here anymore',
  'dont want to live',
  'suicidal',
  'suicide',
  'harm myself',
  'harming myself',
  'hurt myself',
  'hurting myself',
  'self harm',
  'self harming',
  'cutting myself',
];

// Returned verbatim. Never generated, never passed through the model, never
// varied — a person in an emergency should get the same words every time.
//
// 911 is Jordan's unified emergency number. The final sentence is not padding:
// this check accepts false positives, so without a way to continue, an
// ordinary question that happens to contain "chest pain" would dead-end.
export const PHYSICAL_EMERGENCY_RESPONSE = [
  'If this is a medical emergency, stop and call 911 now, or go to your',
  'nearest emergency department.',
  '',
  'I am a booking assistant and cannot help with urgent medical situations.',
  '',
  'If this is not an emergency, tell me what kind of doctor you are looking',
  'for and I will help you find one.',
].join(' ');

// Deliberately different in tone as well as content. Telling someone in a
// mental-health crisis to "go to your nearest emergency department" reads as a
// brush-off; this acknowledges them, points at real help, names 911 only for
// immediate danger, and keeps the door open.
//
// No specific NGO or crisis-line number: those change, and a wrong number here
// is worse than none. 911 is stable; everything else stays general.
export const SELF_HARM_RESPONSE = [
  "I'm really sorry you're feeling this way, and I want you to know you don't",
  'have to go through it alone. I\'m only a booking assistant and can\'t provide',
  'the support you deserve right now — but people who can are available. If',
  "you're in immediate danger, please call 911. To talk to someone now, please",
  'reach out to a mental health crisis line or a mental health professional in',
  'your area — free, confidential support is available. If you\'d like, I can',
  'also help you find a doctor to book an appointment with.',
].join(' ');
