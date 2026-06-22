import { knowledgeBase } from "../config/knowledgeBase.js";
import { ApiError } from "../utils/ApiError.js";
import { runOpenAIChat } from "./providers/openaiChat.js";
import { runGeminiChat } from "./providers/geminiChat.js";

const MAX_HISTORY = 20;        // most recent turns kept from the client
const MAX_CHARS = 4000;        // per-message cap

// Keep only well-formed user/assistant turns from the (untrusted) client payload.
const sanitizeHistory = (messages) => {
  if (!Array.isArray(messages)) {
    throw new ApiError(400, "`messages` must be an array");
  }
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (clean.length === 0) {
    throw new ApiError(400, "No valid messages provided");
  }
  return clean;
};

// The single source of truth for the assistant's scope + style. Both providers
// receive this identical instruction, so neither will answer off-topic questions.
export const buildSystemMessage = (user) => {
  const who = user
    ? `The current user is signed in with role "${user.role}". Personalise where helpful and call tools to read their real data instead of guessing.`
    : `The current user is a GUEST (not signed in). You cannot read personal data; when relevant, encourage them to sign up / log in at /auth.`;

  return {
    role: "system",
    content:
      `${knowledgeBase}\n\n# Current session\n${who}\n\n` +
      `# Scope (strict)\n` +
      `You ONLY help with Fillip Skill Academy and using this platform — courses, enrolling, ` +
      `payments, accounts/login, email verification, progress, attendance, certificates, ` +
      `instructor and admin tasks, and related support issues. ` +
      `If the user asks anything unrelated (general knowledge, coding/homework help, math, ` +
      `current events, other companies or products, personal advice, etc.), do NOT answer it ` +
      `even if you know the answer. Instead, in one short sentence, politely decline and steer ` +
      `them back to how you can help with Fillip. Base every answer only on the knowledge base ` +
      `above or on tool results — never on outside information.\n\n` +
      `# Style\nWrite like a helpful human, not a manual. Use plain, friendly language and explain ` +
      `briefly so the answer is genuinely easy to understand — what to do, where (the in-app path, ` +
      `e.g. /courses, /dashboard, /admin/courses), and a touch of why when it helps. Define any ` +
      `jargon in a few words (e.g. "OTP — a one-time code we email you"). Give enough detail to ` +
      `actually solve the problem, but stay focused: a short paragraph, or a tidy numbered/bulleted ` +
      `list for steps — never a wall of text. Mention the contact options (/contact, ` +
      `+91 7463848999, info@fillipskillacademy.com) when the issue needs a human.\n\n` +
      `# Tone\nMirror the user's mood and energy while always staying respectful and professional. ` +
      `If they are excited or casual, be warm and upbeat; if they are brief or formal, be crisp and to the point; ` +
      `if they sound confused or worried, be patient and reassuring. ` +
      `If the user is rude, angry, or uses profanity or insults, do NOT match it — never swear, insult, mock, ` +
      `or fight back. Instead de-escalate: acknowledge their frustration in one calm sentence, stay polite, and ` +
      `refocus on solving their problem. If they remain abusive or you cannot help, gently point them to our ` +
      `team via /contact. Never use offensive, profane, or demeaning language regardless of how the user speaks.`,
  };
};

// Provider runners keyed by name. Each takes { system, history, user } and
// throws on failure so we can fall through to the next one.
const PROVIDER_RUNNERS = { openai: runOpenAIChat, gemini: runGeminiChat };

// Resolve the try-order from configured keys. CHAT_PROVIDER picks the primary
// ("openai" default); the other becomes the automatic fallback.
const resolveProviderOrder = () => {
  const have = {
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  };
  const primary = (process.env.CHAT_PROVIDER || "openai").toLowerCase();
  const order = primary === "gemini" ? ["gemini", "openai"] : ["openai", "gemini"];
  return order.filter((name) => have[name]);
};

/**
 * Run one assistant turn. Tries the primary provider, then falls back to the
 * other if it errors (quota, rate limit, outage…). Stateless — the full history
 * is supplied each call. Both providers share the same Fillip-only system prompt.
 *
 * @returns {Promise<{ reply: string }>}
 */
export const chatService = async ({ messages, user }) => {
  const providers = resolveProviderOrder();

  // No provider configured → degrade gracefully. The scripted quick-reply
  // answers still work on the client; only free-text reaches here.
  if (providers.length === 0) {
    return {
      reply:
        "I can help with the common questions using the buttons above. For anything else, our team is happy to help — reach us via /contact.",
    };
  }

  // Validate input up front (throws 400) — a bad request must not be masked as a
  // provider outage, and we build the prompt once for whichever provider runs.
  const history = sanitizeHistory(messages);
  const system = buildSystemMessage(user);

  let lastErr;
  for (const name of providers) {
    try {
      return await PROVIDER_RUNNERS[name]({ system, history, user });
    } catch (err) {
      lastErr = err;
      console.error(`[chat] provider "${name}" failed:`, err?.status ?? err?.statusCode ?? "", err?.message ?? err);
      // fall through to the next provider
    }
  }

  // Every provider failed — never surface a raw 500 to the chat UI.
  console.error("[chat] all providers failed; last error:", lastErr?.message ?? lastErr);
  return {
    reply:
      "Sorry — I can't reach the assistant right now. Please try again in a moment, or reach our team via /contact.",
  };
};
