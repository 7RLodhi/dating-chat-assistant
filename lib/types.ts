export type Tone = "casual" | "playful" | "witty" | "sincere" | "flirty" | "spicy" | "auto";

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
  /** Client-computed taste summary from the user's past votes (see lib/tasteProfile). */
  tasteProfile?: string;
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

export interface PendingOutcome {
  id: string;
  generationId?: string;
  matchId?: string;
  matchName: string;
  suggestionText: string;
  copiedAt: string; // ISO timestamp
  /** Conversation row count when copied — nudge fires once the chat grows past this. */
  rowsAtCopy?: number;
}

export interface OutcomeRequestBody {
  generationId?: string;
  matchName?: string;
  suggestionText: string;
  replied: boolean;
}

export interface FantasyRequestBody {
  language?: string;
  avoid?: string[];
  count?: number;
}

export interface FantasyResponse {
  items: string[];
}

export type OccupationType = "student" | "professional" | "";
export type EducationLevel = "school" | "college" | "";

export interface MatchFacts {
  summary: string;
  /** ISO YYYY-MM-DD, only filled when the full date (including year) is known. */
  dob: string;
  /** Stated age as a plain number-string, used when dob isn't known. */
  age: string;
  location: string;
  occupationType: OccupationType;
  educationLevel: EducationLevel;
  /** School only, e.g. "11th". */
  schoolClass: string;
  /** School only, and only relevant for 11th/12th, e.g. "Science". */
  schoolStream: string;
  /** College only, e.g. "2nd year" or "final year". */
  collegeYear: string;
  /** College only, e.g. "B.Tech", "B.Com". */
  degree: string;
  /** College only, e.g. "Computer Science". */
  branch: string;
  /** Professional only. */
  company: string;
  /** Professional only, their job title. */
  jobRole: string;
  /** Professional only, where they work (if different from general location). */
  jobLocation: string;
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

export interface NamePun {
  id: string;
  name: string;
  pun: string;
  worked: number;
  notWorked: number;
  createdAt: string;
}

export type PunVote = "worked" | "notWorked";

export interface AddPunRequestBody {
  name: string;
  pun: string;
}

export interface VotePunRequestBody {
  id: string;
  vote: PunVote;
}

export interface RequestPunRequestBody {
  name: string;
}
