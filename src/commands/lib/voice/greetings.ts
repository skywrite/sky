/**
 * Opening lines for a voice session. Every greeting is "Hey {name}, " and
 * then one phrase drawn at random from this pool, so no two sessions open
 * the same way — the scripted greeting doubles as the audio-path check,
 * and hearing the identical sentence every time made it feel like a test
 * tone rather than a hello. The name comes from the AboutMe profile and
 * simply drops when there is none: "Hey, what's on your mind?"
 *
 * Every phrase is the first thing said, before the user has spoken, so it
 * must stand on its own: an open invitation. Nothing that answers,
 * continues, or presumes — no "go on", no "over to you", no "what's the
 * plan" (there is no plan yet). The test enforces the obvious offenders.
 *
 * Phrases follow the comma after the name, so they start lowercase unless
 * they start with I or Sky, and they carry no hello of their own. Written
 * for the session persona — confident, composed — short and spoken, never
 * chirpy. Time-of-day greetings are deliberately absent — the pool knows
 * nothing about the clock.
 */

export const PHRASES: readonly string[] = [
  'what would you like to talk about?',
  "what's on your mind?",
  'where shall we start?',
  "I'm listening. What's on your mind?",
  'where shall we begin?',
  'ask me anything, or just think out loud.',
  'what do you need?',
  "I'm listening.",
  'what can I find for you?',
  'what would you like to know?',
  "something on your mind, or shall I check what's coming up?",
  'where would you like to begin?',
  "what's on your mind today?",
  "tell me what you're after.",
  "what's first?",
  "I'm here. Talk to me.",
  'what are we sorting out today?',
  "I'm all ears.",
  'shall we get straight to it?',
  'fire away.',
  "whenever you're ready.",
  "let's begin. What do you need?",
  'what can I do for you?',
  "I'm listening. Take your time.",
  "what's the first thing?",
  'what would you like to look into?',
  "what's worth talking through?",
  "anything you'd like me to look up?",
  "I'm ready when you are.",
  'what shall we make sense of?',
  'ask me anything.',
  "what's on?",
  'where do you want to start?',
  "what's the first thing on your mind?",
  'what do you need from the notebook?',
  "just say what you're wondering about.",
  'what shall we look at first?',
  'start anywhere.',
  'good to hear your voice. What would you like to talk about?',
  'ask away.',
  'what would be useful right now?',
  'where would you like to start?',
  "what's first on your mind?",
  'what would you like to get done?',
  "what's worth a look today?",
  'what needs an answer?',
  "where's your head at?",
  'tell me what you need.',
  "what's been on your mind lately?",
  'what can I help you think through?',
  'what would you like from the notebook?',
  "I'm all yours. What's first?",
  "let's make this useful. What do you need?",
  "what's on today?",
  "what's the thing you keep coming back to?",
  'what do you want to look at?',
  'start wherever you like.',
  'what shall I check for you?',
  "what's the first thing you'd like to know?",
  "I'm listening. Go ahead.",
  'anything I can find for you?',
  'where do we start?',
  'something specific, or a wander through the notebook?',
  "what's worth knowing today?",
  'shall we make a start?',
  'what can I dig up for you?',
  'what can I look up for you?',
  'what would you like to think through?',
  'what would help most right now?',
  'something on your mind?',
  "speak whenever you're ready.",
  'what would you like to sort out?',
  'what have you got for me?',
  "let's not waste a minute. What do you need?",
  'what are you curious about?',
  "I'm listening. What's going on?",
  "what's the one thing to sort out?",
  'what would you like to look at?',
  'what shall we look into?',
  'what would you like to talk through?',
  "what's happening?",
  'ask me something.',
  "what's the first thing you'd like to look at?",
  "what's rattling around in your head?",
  'what do you want to know?',
  "what's the first order of business?",
  "whatever needs finding, I'll find it.",
  'shall we begin?',
  'what do you want to get straight?',
  "I've got your notebook right here. Ask me anything.",
  "the notebook's open. Where shall we start?",
  "your notebook's right here. What do you need?",
  "I've got the notebook up. What's first?",
  'what are we looking at?',
  'what would you like to get into?',
  "take your time. I'm listening.",
  'ready when you are.',
  'what shall we start with?',
  "what's worth looking into?",
  'what would you like to find out?',
  "anything you'd like to look at?",
  "I'm here. What do you need?",
  'what would you like to check?',
  'what are we digging into?',
  'where would you like to start today?',
  'what do you want to talk through?',
  'what can I get you?',
  'whenever you like.',
  "what's up?",
]

/**
 * The greeting as a Handlebars template for renderTemplate, whose `me`
 * namespace carries the AboutMe profile: "Hey Jane, <phrase>" with a first
 * name, "Hey, <phrase>" without one.
 */
export function greetingTemplate(phrase: string): string {
  return `Hey{{#if me.firstName}} {{me.firstName}}{{/if}}, ${phrase}`
}

/** A random opening line, ready for renderTemplate. `random` is injectable for tests. */
export function pickGreeting(random: () => number = Math.random): string {
  const index = Math.min(PHRASES.length - 1, Math.floor(random() * PHRASES.length))
  return greetingTemplate(PHRASES[index] as string)
}
