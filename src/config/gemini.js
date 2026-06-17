import { GoogleGenAI } from "@google/genai";


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

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
