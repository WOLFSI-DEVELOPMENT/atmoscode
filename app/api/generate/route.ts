import { GoogleGenAI, Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { tavily } from "@tavily/core";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY || "tvly-DUMMY" });

export async function POST(req: NextRequest) {
  try {
    const { prompt, model, messages } = await req.json();
    let modelToUse = model || "gemini-2.5-flash";
    
    // fall back to 2.5 if 3.5 is requested and not available
    if (modelToUse.includes('3.5')) modelToUse = 'gemini-2.5-flash';

    const systemInstruction = `You are an expert full-stack developer AI. 
Provide your response using the following exactly-formatted tags. You can use them multiple times. Do NOT wrap your message in markdown code blocks.

<thought>
Your thinking process, plan, or reasoning. Share your step by step logic.
</thought>

<command>
npm install some-library
</command>

<file path="src/App.tsx">
file contents here
</file>

Strict Rules:
1. Provide all files needed for a React Vite app. You MUST provide package.json, package-lock.json (can be minimal), vite.config.ts, index.html, src/main.tsx, and src/App.tsx.
2. ALWAYS use Tailwind CSS and provide its configuration files (tailwind.config.js, postcss.config.js, src/index.css).
3. ALWAYS use the hugeicons-react library for icons.
4. Only use <command> if you need to install a library or run a build. 
5. Make sure to use the latest, modern package versions in package.json (e.g., React 19+, Vite 6+, TypeScript 5.5+). Do not use old versions like React 18 or Vite 4.
6. After providing and editing all files, you MUST end with <command>npm run build</command> to verify it works.
7. Finally, provide a brief, humble conclusion message. Keep it under 3 bullet points. Focus on functional outcomes. Absolutely NO marketing hype, NO emojis, and NO adjectives like 'gorgeous' or 'premium'. Do not wrap your message in any tags.`;

    let historyFormatted: any[] = [];
    if (messages && messages.length > 0) {
       historyFormatted = messages.map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.contents }]
       }));
    }

    const chat = ai.chats.create({
       model: modelToUse,
       config: {
          systemInstruction,
          tools: [{
             functionDeclarations: [{
                name: 'tavilySearch',
                description: 'Search the web using Tavily API to get real-time information or documentation.',
                parameters: {
                   type: Type.OBJECT,
                   properties: { query: { type: Type.STRING } },
                   required: ['query']
                }
             }]
          }]
       },
       history: historyFormatted
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let currentMsg = prompt;
          let hasMoreTurns = true;
          
          while (hasMoreTurns) {
             hasMoreTurns = false;
             const responseStream = await chat.sendMessageStream(currentMsg);
             
             let toolCallResults: any[] = [];
             
             for await (const chunk of responseStream) {
               if (chunk.text) {
                 await new Promise(r => setTimeout(r, 70));
                 controller.enqueue(encoder.encode(chunk.text));
               }
               
               if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                 for (const call of chunk.functionCalls) {
                    if (call.name === 'tavilySearch' && call.args) {
                       const query = call.args.query as string;
                       controller.enqueue(encoder.encode(`\n<search query="${query}">\nSearching...\n`));
                       
                       let searchRes = "";
                       try {
                          if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY !== "tvly-DUMMY") {
                             const res = await tvly.search(query, { searchDepth: 'basic', maxResults: 3 });
                             searchRes = res.results.map((r: any) => `* [${r.title}](${r.url})\n${r.content}`).join('\n\n');
                          } else {
                             searchRes = "Tavily API key is missing. Simulation: I found some generic results for " + query;
                          }
                       } catch (e) {
                          searchRes = "Failed to search the web.";
                       }
                       
                       controller.enqueue(encoder.encode(`\n${searchRes}\n</search>\n`));
                       
                       toolCallResults.push({
                           functionResponse: {
                               name: call.name,
                               response: { result: searchRes }
                           }
                       });
                    }
                 }
               }
             }
             
             if (toolCallResults.length > 0) {
                currentMsg = toolCallResults;
                hasMoreTurns = true;
             }
          }
        } catch (e: any) {
          controller.enqueue(encoder.encode(`\n[Error Stream Interrupted: ${e.message}]`));
          controller.error(e);
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (error: any) {
    console.error("Failed to generate:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}
