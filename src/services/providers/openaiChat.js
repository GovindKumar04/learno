import { getOpenAI, CHAT_MODEL } from "../../config/openai.js";
import { getToolSchemas, executeTool } from "../chatTools.js";
import { ApiError } from "../../utils/ApiError.js";

const MAX_TOOL_ROUNDS = 5; // safety cap on the tool-calling loop

/**
 * One assistant turn via OpenAI chat-completions, resolving any tool calls
 * against live app data. Throws on failure so the orchestrator can fall back
 * to another provider; the orchestrator owns the user-facing graceful message.
 *
 * @param {{ system: object, history: object[], user: object|null }} args
 * @returns {Promise<{ reply: string }>}
 */
export const runOpenAIChat = async ({ system, history, user }) => {
  const openai = getOpenAI();
  const tools = getToolSchemas(user);
  const convo = [system, ...history];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: convo,
      tools,
      temperature: 0.3,
      max_tokens: 700, // bounded cost per reply
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg) throw new ApiError(502, "No response from OpenAI");

    // No tool calls → final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: (msg.content || "").trim() || "Sorry, I didn't catch that — could you rephrase?" };
    }

    // Execute each requested tool and feed results back.
    convo.push(msg);
    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      const result = await executeTool(call.function.name, args, user);
      convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new ApiError(502, "OpenAI tool loop did not converge");
};
