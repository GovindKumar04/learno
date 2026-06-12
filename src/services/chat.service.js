import { getOpenAI, CHAT_MODEL } from "../config/openai.js";
import { knowledgeBase } from "../config/knowledgeBase.js";
import { getToolSchemas, executeTool } from "./chatTools.js";
import { ApiError } from "../utils/ApiError.js";

const MAX_HISTORY = 20;        // most recent turns kept from the client
const MAX_CHARS = 4000;        // per-message cap
const MAX_TOOL_ROUNDS = 5;     // safety cap on the tool-calling loop

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

const buildSystemMessage = (user) => {
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
      `# Style\nReply in a few short sentences or a tight bulleted list of steps. ` +
      `Include the relevant in-app path (e.g. /courses, /dashboard, /admin/courses) when guiding the user.`,
  };
};

/**
 * Run one assistant turn: an OpenAI chat-completion loop that resolves any tool
 * calls against live app data, scoped to `user`. Stateless — the full history is
 * supplied each call (nothing is persisted).
 *
 * @returns {Promise<{ reply: string }>}
 */
export const chatService = async ({ messages, user }) => {
  // No key configured yet → degrade gracefully instead of erroring. The scripted
  // quick-reply answers still work on the client; only free-text reaches here.
  if (!process.env.OPENAI_API_KEY) {
    return {
      reply:
        "I can help with the common questions using the buttons above. For anything else, our team is happy to help — reach us via /contact.",
    };
  }

  const openai = getOpenAI();
  const tools = getToolSchemas(user);

  const convo = [buildSystemMessage(user), ...sanitizeHistory(messages)];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: convo,
      tools,
      temperature: 0.3,
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg) throw new ApiError(502, "No response from the language model");

    // No tool calls → this is the final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: (msg.content || "").trim() || "Sorry, I didn't catch that — could you rephrase?" };
    }

    // Otherwise execute each requested tool and feed the results back.
    convo.push(msg);
    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      const result = await executeTool(call.function.name, args, user);
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Tool loop didn't converge — give a graceful fallback.
  return {
    reply:
      "I'm having trouble pulling that together right now. Please try rephrasing, or reach our team via /contact.",
  };
};
