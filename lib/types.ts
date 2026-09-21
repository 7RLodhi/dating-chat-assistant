export type Tone = "playful" | "sincere" | "witty" | "bold" | "low_effort";

export type Goal = "get_a_reply" | "escalate_to_date" | "keep_it_light";

export type Mode = "reply" | "opener";

export type Language = "auto" | "english" | "hindi" | "hinglish";

export type MoodLabel =
  | "high_interest"
  | "playful"
  | "neutral"
  | "cooling_off"
  | "disengaged"
  | "mixed_signals";

export interface Suggestion {
  text: string;
  tone: Tone | string;
  approach: string;
  rationale: string;
}

export interface ConversationRead {
  mood_label: MoodLabel | string;
  confidence: number;
  summary: string;
}

export interface SuggestResponse {
  id?: string;
  conversation_read?: ConversationRead;
  suggestions: Suggestion[];
}

export interface SuggestRequestBody {
  mode: Mode;
  conversationText?: string;
  profileText?: string;
  tone: Tone;
  goal: Goal;
  extraContext?: string;
  /** Raw examples of messages the user has actually sent, used as a voice reference. */
  styleExamples?: string;
  /** Defaults to "auto" (detect from the conversation/profile text) if omitted. */
  language?: Language;
  /** Whether the input text currently came from screenshot OCR rather than manual paste. */
  viaScreenshot?: boolean;
  /** Match's name, mode "opener" only — enables an optional name-pun suggestion. */
  matchName?: string;
}

export interface FeedbackRequestBody {
  suggestionText: string;
  tone: string;
  approach: string;
  vote: "up" | "down";
  generationId?: string;
}

export interface StyleAnalysis {
  summary: string;
  traits: string[];
}

export interface StyleAnalyzeRequestBody {
  sampleMessages: string;
}

export interface OcrRequestBody {
  imageBase64: string;
  mimeType: string;
  /** Determines which transcription instructions to use. Defaults to "conversation". */
  kind?: "conversation" | "profile";
}

export interface OcrResponse {
  text: string;
}

export interface MatchFacts {
  summary: string;
  birthdate: string;
  hobbies: string[];
  taste: string[];
  surprises: string;
  dreams: string[];
  wishlist: string[];
  fantasies: string[];
  other: string[];
  updatedAt: string;
}

export type FactsResponse = Omit<MatchFacts, "updatedAt">;

export interface FactsRequestBody {
  bio: string;
  conversationText: string;
  previousFacts?: FactsResponse;
}
