/**
 * Opening lines for ai:voice. One is drawn at random when the session
 * starts, so no two sessions open the same way — the scripted greeting
 * doubles as the audio-path check, and hearing the identical sentence
 * every time made it feel like a test tone rather than a hello.
 *
 * Every line is the first thing said, before the user has spoken, so it
 * must stand on its own: a hello and an open invitation. Nothing that
 * answers, continues, or presumes — no "go on", no "over to you", no
 * "what's the plan" (there is no plan yet). The test enforces the
 * obvious offenders.
 *
 * Lines are written for the session persona: a confident British woman,
 * short and spoken, never chirpy. `{name}` marks where the user's first
 * name goes; it must follow a word (", {name}" or " {name}") so the line
 * still reads cleanly when no AboutMe profile exists. Time-of-day
 * greetings are deliberately absent — the list knows nothing about the
 * clock.
 */

export const GREETINGS: readonly string[] = [
  'Hello, {name}. What would you like to talk about?',
  "Hi, {name}. What's on your mind?",
  'Right then, {name}. Where shall we start?',
  "I'm listening. What's on your mind?",
  'Hello, {name}. Where shall we begin?',
  'Ask me anything, or just think out loud.',
  'Sky here, {name}. What do you need?',
  "Hi, {name}. I'm listening.",
  'Hello, {name}. Ready when you are.',
  'What can I find for you?',
  'Hello. What would you like to know?',
  "Hi, {name}. Something on your mind, or shall I check what's coming up?",
  'Where would you like to begin?',
  "Hello, {name}. What's on your mind today?",
  "Hello, {name}. Tell me what you're after.",
  "Good to hear you, {name}. What's first?",
  "I'm here. Talk to me.",
  'Hi. What would you like to talk about?',
  'Hi, {name}. What are we sorting out today?',
  "Hello, {name}. I'm all ears.",
  'Hello, {name}. Shall we get straight to it?',
  'Fire away.',
  "Sky here. What's on your mind?",
  "Hi there, {name}. Whenever you're ready.",
  "Right, let's begin. What do you need?",
  'Hello, {name}. What can I do for you?',
  "I'm listening. Take your time.",
  "Now then, {name}. What's the first thing?",
  'Hi, {name}. What would you like to look into?',
  "Hello. What's worth talking through?",
  "Hi, {name}. Anything you'd like me to look up?",
  "Hello. I'm ready when you are.",
  'Hello, {name}. What shall we make sense of?',
  'Hello, {name}. Ask me anything.',
  "Ready when you are, {name}. What's on?",
  'Where do you want to start?',
  "Hi, {name}. What's the first thing on your mind?",
  'Hi, {name}. What do you need from the notebook?',
  "Just say what you're wondering about.",
  'Hello. What shall we look at first?',
  'Hello, {name}. Start anywhere.',
  'Hello, {name}. Good to hear your voice. What would you like to talk about?',
  'Ask away.',
  'Hello, {name}. What would be useful right now?',
  'Hi, {name}. Where would you like to start?',
  "What's first on your mind?",
  'Hello. Sky here. What do you need?',
  'Hello. What would you like to get done?',
  "Hello, {name}. What's worth a look today?",
  'Hello, {name}. What needs an answer?',
  "Where's your head at?",
  'Hi. Tell me what you need.',
  "Hello, {name}. What's been on your mind lately?",
  'What can I help you think through?',
  'Hello, {name}. What would you like from the notebook?',
  "I'm all yours. What's first?",
  "Hi, {name}. Let's make this useful. What do you need?",
  "Hi, {name}. What's on today?",
  "What's the thing you keep coming back to?",
  'Hello. What do you want to look at?',
  'Hello. Start wherever you like.',
  'What shall I check for you?',
  "Hello, {name}. What's the first thing you'd like to know?",
  "Hello, {name}. I'm listening. Go ahead.",
  'Hi, {name}. Anything I can find for you?',
  'Hello, {name}. Where do we start?',
  'Something specific, or a wander through the notebook?',
  "Hello. Sky here. What's on your mind?",
  "Hello, {name}. What's worth knowing today?",
  'Tell me what you need.',
  'Hello, {name}. Shall we make a start?',
  'Hello, {name}. What can I dig up for you?',
  'Hi. What can I look up for you?',
  "Hi, {name}. What's first?",
  'Start wherever you like.',
  'Hello, {name}. What would you like to think through?',
  'What would help most right now?',
  'Hello. Something on your mind?',
  "Speak whenever you're ready.",
  'Hi, {name}. What would you like to sort out?',
  'What have you got for me?',
  "Hello, {name}. Let's not waste a minute. What do you need?",
  'Hello, {name}. What are you curious about?',
  "I'm listening. What's going on?",
  "Hi, {name}. What's the one thing to sort out?",
  'Hi. What would you like to look at?',
  'Sky here. What shall we look into?',
  'Hello, {name}. What would you like to talk through?',
  "Hello, {name}. I'm listening. What's on your mind?",
  "Well then. What's happening?",
  'Hello, {name}. Ask me something.',
  "Hello. What's on today?",
  "Hello. What's the first thing you'd like to look at?",
  "Hi, {name}. What's rattling around in your head?",
  'Right then. What do you want to know?',
  "Hello, {name}. What's the first order of business?",
  "Hello, {name}. Whatever needs finding, I'll find it.",
  'Shall we begin?',
  'Hi, {name}. What do you want to get straight?',
  'Ready when you are.',
]

/**
 * Turn a greeting line into a Handlebars template for renderTemplate,
 * whose `me` namespace carries the AboutMe profile. The `{name}` slot —
 * with the comma or space before it — appears only when a first name is
 * known, so "Hello, {name}. Ready?" becomes "Hello. Ready?" without one.
 */
export function greetingTemplate(line: string): string {
  return line.replaceAll(/(,? ){name}/g, '{{#if me.firstName}}$1{{me.firstName}}{{/if}}')
}

/** A random opening line, ready for renderTemplate. `random` is injectable for tests. */
export function pickGreeting(random: () => number = Math.random): string {
  const index = Math.min(GREETINGS.length - 1, Math.floor(random() * GREETINGS.length))
  return greetingTemplate(GREETINGS[index] as string)
}
