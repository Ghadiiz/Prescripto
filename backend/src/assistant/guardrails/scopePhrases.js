// Phrases that end the turn with a fixed "out of scope" redirect.
//
// PRECISION-FAVOURING — the opposite of emergencyPhrases.js. There a false
// negative meant a booking assistant answering a medical crisis. Here a false
// POSITIVE refuses a legitimate booking question, which breaks the core
// function of the product. When in doubt, let it pass.
//
// Every entry is a multi-word INTENT phrase. Never a bare topic word: a lone
// `weather` or `write` would reject "do you have a doctor near the weather
// station?" and "write down which doctors treat skin problems", both of which
// are ordinary booking questions. A test asserts every entry contains a space.

// Where this gate actually earns its place. The model is *able* to answer
// "what's the capital of France" and may helpfully do so — drifting from
// purpose and spending one of a 20-per-day request budget on something it
// should never answer at all.
//
// Deliberately NOT listed: `capital of`. "Do you have a doctor in the capital
// of Jordan?" is a real question about Amman. General knowledge is unbounded
// and cannot be enumerated; those requests reach the model, where the system
// prompt declines them. That is the accepted gap.
export const OFF_TOPIC_PHRASES = [
  // Creative writing
  'write me a poem',
  'write a poem',
  'write me a story',
  'write a story',
  'write me an essay',
  'write an essay',
  'write me a song',
  'write a song',
  'tell me a joke',

  // Weather
  'whats the weather',
  'what is the weather',
  'weather forecast',
  'weather tomorrow',

  // Homework and general assistant work
  'do my homework',
  'my homework',
  'solve this equation',
  'do this math',
  'translate this',
  'translate the following',
  'summarise this article',
  'summarize this article',

  // Code
  'write me code',
  'write code for',
  'write a function',
  'write a program',
  'debug this code',

  // Trivia
  'who won the',
  'recipe for',
];

// A THIN BACKUP, not the defence. The system prompt already refuses to
// diagnose — verified live: "I am not a doctor and cannot diagnose you. A
// neurologist handles concerns related to headaches" — and the no-write
// architecture means the assistant cannot prescribe regardless. This list
// exists as jailbreak and model-drift insurance for the unmistakable cases
// only.
//
// Deliberately NOT listed: `is it serious`, `should i be worried`. Both read
// as advice-seeking but appear innocently — "is it serious if I miss my
// appointment?", "should I be worried about the fee?" — and refusing those
// breaks the product. The prompt handles them.
export const MEDICAL_ADVICE_PHRASES = [
  'what should i take',
  'what medicine should i take',
  'what medication should i take',
  'whats wrong with me',
  'what is wrong with me',
  'diagnose me',
  'can you diagnose',
  'prescribe me',
  'can you prescribe',
  'do i need antibiotics',
  'what dosage',
  'what dose',
  'how many mg',
];

// One fixed response for both categories. Redirects rather than dead-ends,
// the same pattern the emergency responses use.
export const OUT_OF_SCOPE_RESPONSE = [
  'I can only help you find and book with doctors at Prescripto.',
  'What are you experiencing, or which kind of doctor are you looking for?',
].join(' ');
