import { GoogleGenAI, Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { tavily } from "@tavily/core";
import OpenAI from "openai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY || "tvly-DUMMY" });

export async function POST(req: NextRequest) {
  try {
    const { prompt, model, messages } = await req.json();
    let modelToUse = model || "gemini-2.5-flash";
    
    // fall back to 2.5 if 3.5 is requested and not available natively, though maybe openrouter has it, but assume if no slash it's google
    if (modelToUse.includes('3.5') && !modelToUse.includes('/')) modelToUse = 'gemini-2.5-flash';

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
1. If building from scratch, provide all files needed for a React Vite app. You MUST provide package.json, package-lock.json (can be minimal), vite.config.ts, index.html, src/main.tsx, and src/App.tsx.
2. If making an update or fix, ONLY output the <file> blocks for files that actually require changes. Do not output unchanged files. Keep your edits surgical and smart.
3. ALWAYS use Tailwind CSS and provide its configuration files (tailwind.config.js, postcss.config.js, src/index.css).
4. ALWAYS use the hugeicons-react library for icons.
5. Only use <command> if you need to install a library or run a build. 
6. Make sure to use the latest, modern package versions in package.json (e.g., React 19+, Vite 6+, TypeScript 5.5+). Do not use old versions like React 18 or Vite 4.
7. After providing and editing all files, you MUST end with <command>npm run build</command> to verify it works.
8. Finally, provide a brief, humble conclusion message. Keep it under 3 bullet points. Focus on functional outcomes. Absolutely NO marketing hype, NO emojis, and NO adjectives like 'gorgeous' or 'premium'. Do not wrap your message in any tags.`;

    const isOpenRouter = modelToUse.includes('/');
    let openai: OpenAI | null = null;
    if (isOpenRouter) {
       openai = new OpenAI({
         baseURL: "https://openrouter.ai/api/v1",
         apiKey: process.env.OPENROUTER_API_KEY || "dummy",
       });
    }

    let historyFormatted: any[] = [];
    if (messages && messages.length > 0) {
       if (isOpenRouter) {
         historyFormatted = messages.map((m: any) => ({
            role: m.role,
            content: m.contents
         }));
       } else {
         historyFormatted = messages.map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.contents }]
         }));
       }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (isOpenRouter && openai) {
             let conversation = [
               { role: 'system', content: systemInstruction },
               ...historyFormatted,
               { role: 'user', content: prompt }
             ];
             
             let hasMoreTurns = true;
             while (hasMoreTurns) {
                hasMoreTurns = false;
                
                const responseStream = await openai.chat.completions.create({
                   model: modelToUse,
                   messages: conversation as any,
                   stream: true,
                   tools: [{
                      type: "function",
                      function: {
                         name: "tavilySearch",
                         description: "Search the web using Tavily API to get real-time information or documentation.",
                         parameters: {
                            type: "object",
                            properties: { query: { type: "string" } },
                            required: ["query"]
                         }
                      }
                   }]
                });
                
                let toolCallBuf: any = {};
                let assistantMessage = "";
                
                for await (const chunk of responseStream) {
                   const delta = chunk.choices[0]?.delta;
                   if (delta?.content) {
                      await new Promise(r => setTimeout(r, 40));
                      controller.enqueue(encoder.encode(delta.content));
                      assistantMessage += delta.content;
                   }
                   if (delta?.tool_calls) {
                      for (const tc of delta.tool_calls) {
                         if (!toolCallBuf[tc.index]) toolCallBuf[tc.index] = { id: tc.id, name: tc.function?.name, args: "" };
                         if (tc.function?.arguments) toolCallBuf[tc.index].args += tc.function.arguments;
                      }
                   }
                }
                
                conversation.push({
                   role: 'assistant',
                   content: assistantMessage || null,
                   tool_calls: Object.values(toolCallBuf).length > 0 ? Object.values(toolCallBuf).map((t: any) => ({
                      id: t.id,
                      type: "function",
                      function: { name: t.name, arguments: t.args }
                   })) : undefined
                } as any);
                
                const toolCallsArr = Object.values(toolCallBuf);
                if (toolCallsArr.length > 0) {
                   for (const call of toolCallsArr as any[]) {
                      if (call.name === 'tavilySearch') {
                         let queryObj: any = { query: call.args };
                         try { queryObj = JSON.parse(call.args); } catch (e) {}
                         const query = queryObj.query || call.args;
                         
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
                         
                         conversation.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            name: call.name,
                            content: JSON.stringify({ result: searchRes })
                         } as any);
                      }
                   }
                   hasMoreTurns = true;
                }
             }
          } else {
             // Gemini 
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

