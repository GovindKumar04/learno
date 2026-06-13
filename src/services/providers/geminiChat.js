import { getGemini, GEMINI_MODEL } from "../../config/gemini.js";
import { getGeminiTools, executeTool } from "../chatTools.js";
import { ApiError } from "../../utils/ApiError.js";

const MAX_TOOL_ROUNDS = 5;

// Map our {role:"user"|"assistant", content} history to Gemini's contents.
const toGeminiContents = (history) =>
  history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

// functionResponse.response must be a JSON object — wrap arrays/scalars.
const asResponseObject = (result) =>
  result && typeof result === "object" && !Array.isArray(result) ? result : { result };

/**
 * Fallback assistant turn via Google Gemini. Mirrors the OpenAI runner: same
 * system prompt (so it stays strictly Fillip-scoped) and the same tools, run in
 * a function-calling loop. Throws on failure so the orchestrator can degrade.
 *
 * @param {{ system: object, history: object[], user: object|null }} args
 * @returns {Promise<{ reply: string }>}
 */
export const runGeminiChat = async ({ system, history, user }) => {
  const ai = getGemini();
  const tools = getGeminiTools(user);
  const contents = toGeminiContents(history);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: system.content, // same Fillip-only scope as OpenAI
        tools,
        temperature: 0.3,
        maxOutputTokens: 700,
      },
    });

    // `functionCalls` / `text` are getters in @google/genai v2; guard either shape.
    const fc = typeof res.functionCalls === "function" ? res.functionCalls() : res.functionCalls;
    const calls = Array.isArray(fc) ? fc : [];

    // No tool calls → final answer.
    if (calls.length === 0) {
      const text = (typeof res.text === "function" ? res.text() : res.text) || "";
      return { reply: text.trim() || "Sorry, I didn't catch that — could you rephrase?" };
    }

    // Append the model's function-call turn, then the tool results.
    contents.push(
      res.candidates?.[0]?.content || {
        role: "model",
        parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })),
      }
    );

    const parts = [];
    for (const c of calls) {
      const result = await executeTool(c.name, c.args || {}, user);
      parts.push({ functionResponse: { name: c.name, response: asResponseObject(result) } });
    }
    contents.push({ role: "user", parts });
  }

  throw new ApiError(502, "Gemini tool loop did not converge");
};
