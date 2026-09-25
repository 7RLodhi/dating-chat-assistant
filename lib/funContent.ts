// Curated side-menu decks. Static by design: these are hand-picked, so the
// content is exactly what was approved — no LLM generation involved.

export interface DoubleMeaningItem {
  question: string;
  answer: string;
}

// Classic Indian "double meaning" paheliyan: the question sounds naughty,
// the answer is innocent — the joke lands on the reveal.
export const DOUBLE_MEANING_QUESTIONS: DoubleMeaningItem[] = [
  { question: "Bachche kaise hote hain?", answer: "Shararti 😇" },
  { question: "Ladkiyon ke baal curvy kahan hote hain?", answer: "Africa mein 🌍" },
  {
    question: "Aisi kaun si cheez hai jo rehti ladki ki hai, lekin leta koi aur hai?",
    answer: "Uska naam — sab log lete hain 😄",
  },
  {
    question: "Aisi kya cheez hai jo shaadi ke baad ladki ki badhti jaati hai?",
    answer: "Zimmedariyan 😌",
  },
  {
    question: "Wo kya hai jo haath mein lete hi khadi ho jaati hai?",
    answer: "Chhatri (umbrella) ☂️",
  },
  {
    question: "Wo kya hai jo andar sukha jaata hai aur bahar geela nikalta hai?",
    answer: "Tea bag ☕",
  },
  {
    question: "Wo kya cheez hai jo pehle andar jaati hai, phir bahar, phir andar?",
    answer: "Sui-dhaaga (needle & thread) 🪡",
  },
  {
    question: "Wo kya hai jo garam hote hi upar uth jaata hai?",
    answer: "Doodh 🥛",
  },
  {
    question: "Aisa kaun sa jaanwar hai jo baithne pe lamba ho jaata hai?",
    answer: "Kutta 🐕",
  },
  {
    question: "Wo kya hai jiske andar daalo toh wo khush ho jaati hai?",
    answer: "Gullak (piggy bank) 🐷",
  },
  {
    question: "Wo kya cheez hai jo lambi ho toh raat bhar chalti hai?",
    answer: "Mombatti (candle) 🕯️",
  },
  {
    question: "Wo kya hai jo jitna chuso utna chhota hota jaata hai?",
    answer: "Toffee 🍬",
  },
  {
    question: "Wo kya cheez hai jo ladki pehle dekhti hai, phir chhooti hai, phir andar leti hai?",
    answer: "Golgappa 😋",
  },
  {
    question: "Wo kya hai jo raat ko bistar pe hota hai aur subah gaayab?",
    answer: "Sapna (dream) 💭",
  },
  {
    question: "Wo kya hai jo jitna ragdo utna garam hota hai?",
    answer: "Haath (hands in winter) 🙌",
  },
  {
    question: "Aisi kaun si cheez hai jo phoolti hai toh sabko khushi hoti hai?",
    answer: "Gubbara (balloon) 🎈",
  },
];

// Fantasy-location conversation prompts, strictly 18+. Shared as "would you?"
// questions between consenting adults — talk, not a plan.
export const DARK_FANTASY_ITEMS: string[] = [
  "चलती कार की पिछली सीट पर sex",
  "ठंडी रात में खुली छत पर तारों के नीचे",
  "किसी शांत और सुनसान जंगल में पेड़ों की आड़ में",
  "ट्रेन का पब्लिक वॉशरूम",
  "सिनेमा हॉल की आखिरी सीट",
  "किसी ऊंची बिल्डिंग की लिफ्ट में",
  "होटल की बालकनी पर",
  "स्विमिंग पूल में",
  "समुद्र तट पर",
  "शॉपिंग स्टोर का ट्रायल रूम",
  "ऑफिस के किसी ग्लास केबिन में",
  "लाइब्रेरी का कोना",
  "बेसमेंट पार्किंग के अंधेरे कोने में",
  "पहाड़ी की चोटी पर",
  "होटल की इमरजेंसी सीढ़ियों पर",
  "बारिश के दौरान कैंपिंग टेंट के अंदर sex",
];

/** Turns a fantasy item into a ready-to-send question. */
export function fantasyAsQuestion(item: string): string {
  return `Sach batao 😏 — ${item}? Haan ya na?`;
}
