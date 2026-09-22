// First-run sample match: lets a new user see real suggestions within ~30
// seconds, before they've pasted anything of their own. Created on demand via
// the empty-state button (never automatically), flagged demo: true so the UI
// can banner it, and deletable like any other match.

export const SAMPLE_MATCH_NAME = "Priya";

export const SAMPLE_MATCH_BIO =
  "26. Marketing manager by day, amateur baker by night. Looking for someone who can handle both my playlists and my puns. Bonus points if you know the best momos in town.";

export const SAMPLE_MATCH_CONVERSATION = [
  "[MATCH]: heyy! so what's the story behind the amateur baker thing? 🧁",
  "[USER]: haha long story involving a lockdown, too much free time, and a very patient roommate",
  "[MATCH]: lol same, mine was sourdough. did any of it actually turn out edible?",
  "[USER]: the banana bread was elite, the croissants were a war crime. what's your signature dish?",
  "[MATCH]: butter chicken that my mom still claims is better 😌",
].join("\n");
