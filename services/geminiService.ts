import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types";

// Initialize Gemini
// NOTE: API key must be in process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeFlow = async (imageBase64: string): Promise<AnalysisResult> => {
  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg);base64,/, "");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/png",
            data: cleanBase64,
          },
        },
        {
          text: `You are an expert Aerodynamicist. 
          Analyze this 2D CFD simulation (visualized as a flow field).
          The image shows a fluid flowing from left to right around a solid black object. 
          Colors represent velocity or curl.
          
          1. Identify the object shape.
          2. Describe the flow characteristics (e.g., turbulence, wake size, flow separation, laminar vs turbulent).
          3. Estimate a qualitative drag coefficient (Low/Medium/High) and explain why.
          4. Suggest 2 specific design changes to improve aerodynamics (reduce drag).
          
          Respond in valid JSON matching this schema:
          {
            "title": "Short title of the object",
            "description": "2-3 sentences analyzing the flow.",
            "dragEstimate": "Low | Medium | High",
            "suggestions": ["Suggestion 1", "Suggestion 2"]
          }
          `
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            dragEstimate: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    
    return JSON.parse(text) as AnalysisResult;

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return {
      title: "Analysis Failed",
      description: "Could not analyze the flow at this time. Please try again.",
      dragEstimate: "Unknown",
      suggestions: []
    };
  }
};
