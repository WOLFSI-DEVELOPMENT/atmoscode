import { NextRequest, NextResponse } from "next/server";
import { tavily } from "@tavily/core";
import OpenAI from "openai";

export async function POST(req: NextRequest) {
  try {
    const { prompt, model, messages, skills } = await req.json();
    let modelToUse = model || "google/gemini-2.5-flash";
    
    // Always use OpenRouter logic now
    if (!process.env.OPENROUTER_API_KEY) {
       return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured" }, { status: 500 });
    }

    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY || "tvly-DUMMY" });
    
    // We expect models to have a slash, if not add google/ as default
    if (!modelToUse.includes('/')) {
        modelToUse = `google/${modelToUse}`;
    }

    let systemInstruction = `You are an expert full-stack developer AI. 
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
1. If building from scratch, provide all files needed for a Next.js app (App Router). You MUST provide package.json, next.config.mjs, tsconfig.json, app/layout.tsx, app/page.tsx, and app/globals.css. Before starting project set the whole environment and run <command>npm i next@latest react@latest react-dom@latest</command>.
2. If making an update or fix, ONLY output the <file> blocks for files that actually require changes. Do not output unchanged files. Keep your edits surgical and smart.
3. ALWAYS use Tailwind CSS and provide its configuration files (tailwind.config.mjs, postcss.config.mjs).
4. ALWAYS use the hugeicons-react library for icons.
5. Only use <command> if you need to install a library or run a build. 
6. Make sure to use modern package versions in package.json (e.g., Next 15+, React 18+, TypeScript 5.5+).
7. Always configure the dev script to "dev": "next dev -H 0.0.0.0 -p 5173".
8. After providing and editing all files, you MUST end with <command>npm run dev</command> to restart the dev server and verify it works.
9. Finally, provide a brief conclusion message. Format it as a simple paragraph summarizing your work, followed by a bulleted list. Bold the topic of each bullet (e.g. "- **Feature**: Details..."). Keep it under 3 bullets. Focus on functional outcomes. Absolutely NO marketing hype, NO emojis, and NO adjectives like 'gorgeous' or 'premium'. Do not wrap your message in any XML tags.
10. NEVER manually write package-lock.json. To ensure it exists, always run <command>npm install</command> to generate it automatically within the environment.`;

    if (skills && Array.isArray(skills) && skills.length > 0) {
       systemInstruction += "\n\nAvailable Skills:\n";
       skills.forEach(skill => {
         systemInstruction += `\n--- Skill: ${skill.name} ---\n${skill.description}\n\n${skill.content}\n`;
       });
       systemInstruction += "\nCRITICAL: Read and apply the available skills if they are relevant to the user request.";
    }

    const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY || "dummy",
    });

    let historyFormatted = [];
    if (messages && messages.length > 0) {
        historyFormatted = messages.map((m: any) => ({
            role: m.role,
            content: m.contents
        }));
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
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
                  max_tokens: 8192
               });
               
               let assistantMessage = "";
               
               for await (const chunk of responseStream) {
                  const delta = chunk.choices[0]?.delta;
                  if (delta?.content) {
                     await new Promise(r => setTimeout(r, 40));
                     controller.enqueue(encoder.encode(delta.content));
                     assistantMessage += delta.content;
                  }
               }
               
               conversation.push({
                  role: 'assistant',
                  content: assistantMessage || null
               } as any);
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


