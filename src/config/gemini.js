import { GoogleGenAI } from "@google/genai";

// Lazy singleton so the server still boots when GEMINI_API_KEY is unset; the
// chat fallback only constructs the client when it's actually needed.
let client = null;

export const getGemini = () => {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured on the server");
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
};

// Flash is cheap + fast and has a generous free tier; override with GEMINI_MODEL.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
