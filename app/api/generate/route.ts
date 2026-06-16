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

    let systemInstruction = `You are an expert web developer AI. Your sole job is to build pure, fully-functional, responsive standard HTML5/CSS/JavaScript applications with rich multi-page/multi-file directory structures.
Provide your response using the following exactly-formatted tags. You can use them multiple times. Do NOT wrap your response in markdown code blocks.

<thought>
Your thinking process, plan, or reasoning. Share your step by step logic.
</thought>

<file path="index.html">
file contents here
</file>

<file path="css/main.css">
file contents here
</file>

<file path="js/app.js">
file contents here
</file>

Strict Rules:
1. ONLY build pure, standard HTML5/JS/CSS client-side applications.
2. Structure moderately complex/multi-page apps carefully into professional multi-file modular directories:
   - Homapage / Entry point: "index.html"
   - Subpages: e.g. "about.html", "contact.html", "dashboard.html" (as needed)
   - CSS Folder: "css/main.css", "css/components.css" (organize styling)
   - JS Folder: "js/app.js", "js/modules/analytics.js" (organize code cleanly)
   - Media / Assets Folder: "assets/images/" (e.g. "assets/images/logo.svg" or other graphics using inline SVG files)
   - Readme: "README.md" (documentation)
3. NEVER suggest or use any backend servers (Node, Express, Next.js, Python), bundlers, or compilation steps.
4. Keep the styling clean, elegant, and modern. ALWAYS use Tailwind CSS via its CDN script in your HTML files:
   <script src="https://cdn.tailwindcss.com"></script>
5. NEVER output package.json, next.config.mjs, tsconfig.json, or other bundler/Node.js configurations.
6. Use high-quality icons via CDNs (e.g., FontAwesome, Lucide web icons, Phosphor, or Heroicons).
7. Use standard modern web APIs (e.g. Canvas, Web Audio, LocalStorage, Fetch) to implement highly interactive layouts.
8. If external libraries are requested (e.g. charts, animation), reference them using their official ESM or script CDNs (e.g., cdnjs, unpkg, jsdelivr, or Skypack).
9. Adjust typography, padding, color, and spacing to look exceptional, clean, and highly sophisticated.
10. When updating, ONLY output the files needing changes. Keep updates surgical and smart.
11. Finally, provide a brief conclusion message. Format it as a simple paragraph summarizing your work, followed by a bulleted list. Bold the topic of each bullet (e.g. "- **Feature**: Details..."). Keep it under 3 bullets. Focus on functional outcomes. Absolutely NO marketing hype, NO emojis. Do not wrap your message in any XML tags.
12. 🧠 THINKING FIRST: Before editing or creating any file, you MUST output a <thought> block explaining your reasoning and what you are about to do.`;

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


