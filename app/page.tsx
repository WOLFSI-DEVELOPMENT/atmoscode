'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Code2,
  Play,
  Moon,
  Sun,
  Layout,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Monitor,
  Download,
  Share,
  Paperclip,
  ArrowUp,
  Terminal,
  FileCode2,
  FolderOpen,
  Folder,
  FileJson,
  FileText,
  Sparkles,
  Pencil,
  CheckCircle2,
  Wrench,
  MessageSquare,
  Lightbulb,
  Settings,
  X,
  Brain,
  Globe,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';

import dynamic from 'next/dynamic';
const Preview = dynamic(() => import('@/components/Preview').then(mod => mod.Preview), { ssr: false });

function Timer({ isRunning }: { isRunning: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);
  return <span>{seconds}s</span>;
}

function summarizeAction(action: any) {
  if (!action) return 'Working...';
  if (action.type === 'file') return `Editing ${action.path.split('/').pop()}`;
  if (action.type === 'command') {
    if (action.command?.includes('build')) return 'Compiling applet';
    if (action.command?.includes('install')) return 'Installing dependencies';
    return `Running command`;
  }
  if (action.type === 'search') return `Searching ${action.query || 'web'}`;
  if (action.type === 'thought') return 'Thinking...';
  return 'Working...';
}

function processActionsIntoGroups(actions: any[]) {
   return actions.reduce((acc, curr) => {
     const last = acc[acc.length - 1];
     if (curr.type === 'file') {
        if (last?.type === 'fileGroup') {
           last.items.push(curr);
           if (!curr.completed) last.completed = false;
        } else {
           acc.push({ type: 'fileGroup', title: 'Editing files', items: [curr], completed: curr.completed });
        }
     } else if (curr.type === 'search') {
        if (last?.type === 'searchGroup') {
           last.items.push(curr);
           if (!curr.completed) last.completed = false;
        } else {
           acc.push({ type: 'searchGroup', title: 'Searching the web', items: [curr], completed: curr.completed });
        }
     } else if (curr.type === 'thought') {
        acc.push({ type: 'thought', items: [curr], completed: curr.completed });
     } else if (curr.type === 'command') {
        let title = 'Running command';
        if (curr.command?.includes('install')) title = 'Installing dependencies';
        if (curr.command?.includes('build')) title = 'Compiling applet';
        acc.push({ type: 'command', title, items: [curr], completed: curr.completed });
     }
     return acc;
   }, [] as any[]);
}

type FileNode = {
  path: string;
  content: string;
};

export type AgentAction = 
  | { type: 'thought'; content: string; completed: boolean }
  | { type: 'file'; path: string; content: string; completed: boolean }
  | { type: 'command'; command: string; completed: boolean }
  | { type: 'search'; query: string; content: string; completed: boolean };

type Message = {
  role: 'user' | 'assistant';
  content?: string;
  files?: FileNode[];
  isGenerating?: boolean;
  actions?: AgentAction[];
  isCollapsed?: boolean;
};

const parseFullText = (text: string, previousFiles: FileNode[]) => {
   let actions: AgentAction[] = [];
   let message = "";
   let files: FileNode[] = [...previousFiles];
   
   let remaining = text;
   
   while (remaining.length > 0) {
      const tagMatch = remaining.match(/<(thought|command|search(?:\s+query="([^"]+)")?|file(?:\s+path="([^"]+)")?)>/);
      if (!tagMatch) {
         message += remaining;
         break;
      }
      
      const isFile = tagMatch[1].startsWith('file');
      const isSearch = tagMatch[1].startsWith('search');
      
      const tagType = isFile ? 'file' : isSearch ? 'search' : (tagMatch[1] as 'thought' | 'command');
      const tagPath = isFile ? tagMatch[3] : undefined;
      const tagQuery = isSearch ? tagMatch[2] : undefined;
      
      const tagStartIdx = tagMatch.index!;
      if (tagStartIdx > 0) {
          message += remaining.slice(0, tagStartIdx);
      }
      
      const fullOpenTag = tagMatch[0];
      const contentStartIdx = tagStartIdx + fullOpenTag.length;
      
      const closeTagStr = `</${tagType}>`;
      const closeTagIdx = remaining.indexOf(closeTagStr, contentStartIdx);
      
      if (closeTagIdx !== -1) {
         // Closed tag
         const content = remaining.slice(contentStartIdx, closeTagIdx);
         actions.push({
            type: tagType,
            content: tagType !== 'command' ? content : undefined,
            command: tagType === 'command' ? content : undefined,
            path: tagPath,
            query: tagQuery,
            completed: true
         } as any);
         remaining = remaining.slice(closeTagIdx + closeTagStr.length);
      } else {
         // Uncompleted tag, streaming...
         const content = remaining.slice(contentStartIdx);
         actions.push({
            type: tagType,
            content: tagType !== 'command' ? content : undefined,
            command: tagType === 'command' ? content : undefined,
            path: tagPath,
            query: tagQuery,
            completed: false
         } as any);
         remaining = ""; // Wait for more data
      }
   }
   
   // update files based on all file actions (even uncompleted, so it streams in the UI)
   actions.filter(a => a.type === 'file').forEach(a => {
      const fileAction = a as Extract<AgentAction, { type: 'file' }>;
      const existIdx = files.findIndex(f => f.path === fileAction.path);
      if (existIdx !== -1) {
         files[existIdx] = { path: fileAction.path, content: fileAction.content };
      } else {
         files.push({ path: fileAction.path, content: fileAction.content });
      }
   });
   
   return { actions, message, files };
}

export default function BuilderApp() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! What kind of React Vite app would you like to build today?',
    }
  ]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('code');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash');
  const [previewUrl, setPreviewUrl] = useState<string>('localhost:5173');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [editorSettings, setEditorSettings] = useState({
    wordWrap: false,
    fontLigatures: false,
    minimap: true,
    folding: true,
    lineNumbers: true,
    stickyScroll: true,
    renderIndentGuides: true,
  });

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const currentFiles = useMemo(() => messages[messages.length - 1]?.files || [], [messages]);

  const projectName = useMemo(() => {
    const pkgJson = currentFiles.find(f => f.path === 'package.json');
    if (pkgJson) {
      try {
        const pkg = JSON.parse(pkgJson.content);
        return pkg.name || 'Untitled Project';
      } catch (e) {
        return 'Untitled Project';
      }
    }
    return 'Untitled Project';
  }, [currentFiles]);

  useEffect(() => {
    if (currentFiles.length > 0 && !selectedFile) {
      const timer = setTimeout(() => setSelectedFile(currentFiles[0].path), 0);
      return () => clearTimeout(timer);
    }
  }, [currentFiles, selectedFile]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

    const userPrompt = input.trim();
    setInput('');

    if (userPrompt.toLowerCase() === '/skills') {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: 'Skills management is coming soon!' }
      ]);
      return;
    }

    setMessages((prev) => [...prev, { role: 'user', content: userPrompt }]);
    setIsGenerating(true);

    const placeholderMsgIndex = messages.length + 1;
    const previousFiles = [...currentFiles];

    setMessages((prev) => [
      ...prev,
      { role: 'assistant', isGenerating: true, files: previousFiles, actions: [], isCollapsed: false },
    ]);

    try {
      const historyMsg = messages.map(m => ({
         role: m.role,
         contents: m.content || ''
      }));
      if (historyMsg.length > 0) historyMsg.pop(); // Remove the placeholder

      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, model: selectedModel, messages: historyMsg }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || 'Generation failed');
      }
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');
      
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        fullText += decoder.decode(value, { stream: true });
        
        const { actions, message, files } = parseFullText(fullText, previousFiles);
        
        setMessages((prev) => {
          const newMsgs = [...prev];
          newMsgs[placeholderMsgIndex] = {
            ...newMsgs[placeholderMsgIndex],
            actions,
            content: message,
            files
          };
          return newMsgs;
        });

        const hasFileAction = actions.some(a => a.type === 'file');
        if (hasFileAction && activeTab !== 'code') {
           setActiveTab('code');
        }
      }

      setMessages((prev) => {
          const newMsgs = [...prev];
          newMsgs[placeholderMsgIndex] = {
            ...newMsgs[placeholderMsgIndex],
            isGenerating: false,
            isCollapsed: true,
          };
          return newMsgs;
      });
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setMessages((prev) => {
          const newMsgs = [...prev];
          newMsgs[placeholderMsgIndex] = {
            ...newMsgs[placeholderMsgIndex],
            isGenerating: false,
            content: (newMsgs[placeholderMsgIndex].content || '') + '\n\n*[Generation stopped by user]*',
          };
          return newMsgs;
        });
        return;
      }
      setMessages((prev) => {
        const newMsgs = [...prev];
        newMsgs[placeholderMsgIndex] = {
          role: 'assistant',
          content: `Sorry, I encountered an error while generating the code: ${error.message || 'Unknown error'}`,
        };
        return newMsgs;
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileChange = (newContent: string | undefined) => {
    if (!newContent || !selectedFile) return;
    setMessages(prev => {
        const msgs = [...prev];
        const lastMsgIndex = msgs.length - 1;
        if (lastMsgIndex >= 0 && msgs[lastMsgIndex].files) {
            const files = [...msgs[lastMsgIndex].files!];
            const fIdx = files.findIndex(f => f.path === selectedFile);
            if (fIdx !== -1) {
                files[fIdx] = { ...files[fIdx], content: newContent };
                msgs[lastMsgIndex] = { ...msgs[lastMsgIndex], files };
            }
        }
        return msgs;
    });
  };

  const activeFileContent = currentFiles.find(f => f.path === selectedFile)?.content || '';
  
  const getLanguage = (filename: string) => {
    if (filename.endsWith('.json')) return 'json';
    if (filename.endsWith('.css')) return 'css';
    if (filename.endsWith('.html')) return 'html';
    if (filename.endsWith('.md')) return 'markdown';
    if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
    return 'typescript'; // default for ts, tsx
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-zinc-300 font-sans overflow-hidden">
      {/* Left Sidebar - Chat & Context */}
      <div className="w-[380px] relative flex flex-col border-r border-zinc-800 bg-[#111113] shrink-0">
        <div className="h-12 w-full absolute top-0 z-10 border-b border-zinc-800/60 flex items-center px-4 bg-[#0e0e10] shrink-0 font-mono">
          <div className="flex items-center space-x-2 text-zinc-400">
             <Code2 className="w-4 h-4" />
             <span className="text-xs font-medium truncate">{projectName}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide pt-16 pb-48" ref={chatContainerRef}>
          {messages.map((msg, idx) => (
            <div key={idx} className="space-y-2">
              {msg.role === 'assistant' ? (
                <div className="text-sm prose prose-invert max-w-none text-zinc-300">
                  {msg.actions && msg.actions.length > 0 && (
                     <div className="mb-4">
                        {msg.isGenerating && (
                           <div className="mb-4">
                              <div className="flex items-center space-x-2 text-zinc-400 text-xs mb-2">
                                 <span>Gemini 3.1 Pro Preview • Running for <Timer isRunning={true} /></span>
                              </div>
                              <div className="flex items-center space-x-2 text-[#8ca8f9] text-sm">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#8ca8f9]" />
                                <span>{summarizeAction(msg.actions[msg.actions.length - 1])}</span>
                              </div>
                           </div>
                        )}
                        {msg.isCollapsed ? (
                           <button 
                             onClick={() => {
                               setMessages(prev => {
                                 const m = [...prev];
                                 m[idx] = { ...m[idx], isCollapsed: false };
                                 return m;
                               });
                             }}
                             className="flex items-center justify-between px-3 py-1.5 rounded-full border border-zinc-800 bg-[#18181a] hover:bg-zinc-800/60 text-xs text-zinc-300 transition-colors"
                           >
                             <div className="flex items-center space-x-2">
                               <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                               <span className="font-medium">View agent process ({msg.actions.length} steps)</span>
                             </div>
                             <ChevronDown className="w-3.5 h-3.5 ml-2 text-zinc-500" />
                           </button>
                        ) : (
                           <div className="border border-zinc-800/60 rounded-xl bg-transparent my-2 text-zinc-300 overflow-hidden">
                             <div 
                               onClick={() => {
                                 setMessages(prev => {
                                   const m = [...prev];
                                   m[idx] = { ...m[idx], isCollapsed: true };
                                   return m;
                                 });
                               }}
                               className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors bg-[#1a1a1c] select-none border-b border-zinc-800/60"
                             >
                               <div className="flex items-center space-x-3 text-sm">
                                  <Sparkles className="w-4 h-4 text-[#8ca8f9]" />
                                  <span className="text-zinc-300 font-medium">Agent Process</span>
                               </div>
                               <div className="flex items-center space-x-1.5 text-xs text-zinc-400">
                                  <span>Hide details</span>
                                  <ChevronUp className="w-3.5 h-3.5" />
                               </div>
                             </div>
                             
                             <div className="p-4 space-y-6">
                                {processActionsIntoGroups(msg.actions).map((group: any, gIdx: number) => (
                                   <div key={gIdx} className="space-y-3">
                                      <div className="flex items-center space-x-2 text-zinc-300 text-sm font-medium">
                                         {group.type === 'fileGroup' && <Pencil className="w-4 h-4 text-zinc-400" />}
                                         {group.type === 'command' && group.title === 'Compile applet' && <Wrench className="w-4 h-4 text-zinc-400" />}
                                         {group.type === 'command' && group.title !== 'Compile applet' && <Terminal className="w-4 h-4 text-zinc-400" />}
                                         {group.type === 'searchGroup' && <Globe className="w-4 h-4 text-zinc-400" />}
                                         {group.type === 'thought' && <Lightbulb className="w-4 h-4 text-zinc-400" />}
                                         <span>{group.title || 'Thought process'}</span>
                                      </div>
                                      
                                      {group.type === 'thought' ? (
                                        <div className="text-zinc-500 text-xs pl-3 border-l-2 border-zinc-800/50 whitespace-pre-wrap ml-2">
                                           {group.items[0].content}
                                        </div>
                                      ) : group.type === 'searchGroup' ? (
                                        <div className="space-y-2">
                                           {group.items.map((item: any, iIdx: number) => (
                                              <div key={iIdx} className="border border-zinc-800/80 rounded-lg bg-[#0e0e10] p-3 text-sm text-zinc-300">
                                                 <div className="font-mono text-xs text-zinc-400 opacity-80 mb-1">$ tool search &quot;{item.query}&quot;</div>
                                                 {item.completed ? (
                                                    <div className="text-xs text-zinc-500 whitespace-pre-wrap max-h-32 overflow-y-auto">{item.content}</div>
                                                 ) : (
                                                    <div className="flex items-center space-x-2">
                                                       <RefreshCw className="w-3 h-3 text-zinc-500 animate-spin" />
                                                       <span className="text-xs text-zinc-500">Searching...</span>
                                                    </div>
                                                 )}
                                              </div>
                                           ))}
                                        </div>
                                      ) : (
                                        <div className="border border-zinc-800 rounded-lg bg-[#141415] overflow-hidden">
                                           {group.items.map((item: any, iIdx: number) => (
                                              <div key={iIdx} className={`flex items-center justify-between p-3 text-sm text-zinc-300 ${iIdx !== group.items.length - 1 ? 'border-b border-zinc-800/50' : ''}`}>
                                                 <span className="font-mono text-xs">{item.path || item.command}</span>
                                                 {item.completed ? (
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                                 ) : (
                                                    <RefreshCw className="w-4 h-4 text-zinc-500 animate-spin" />
                                                 )}
                                              </div>
                                           ))}
                                        </div>
                                      )}
                                   </div>
                                ))}
                                
                                {msg.isGenerating && (
                                  <div className="flex items-center space-x-3 text-zinc-400 text-sm mt-4 pt-4 border-t border-zinc-800/50">
                                     <div className="w-4 flex justify-center"><RefreshCw className="w-4 h-4 font-bold animate-spin" /></div>
                                     <span>Working...</span>
                                  </div>
                                )}
                             </div>
                           </div>
                        )}
                     </div>
                  )}
                  {msg.content && (
                     <div className="markdown-body">
                       <ReactMarkdown
                         components={{
                           h1: ({node, ...props}) => <h1 className="text-lg font-semibold mt-4 mb-2 text-zinc-100" {...props} />,
                           h2: ({node, ...props}) => <h2 className="text-md font-semibold mt-4 mb-2 text-zinc-100" {...props} />,
                           h3: ({node, ...props}) => <h3 className="text-base font-semibold mt-4 mb-2 text-zinc-100" {...props} />,
                           p: ({node, ...props}) => <p className="mb-4 leading-relaxed" {...props} />,
                           ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-4 space-y-1" {...props} />,
                           ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-4 space-y-1" {...props} />,
                           li: ({node, ...props}) => <li className="text-zinc-300" {...props} />,
                           strong: ({node, ...props}) => <strong className="font-semibold text-zinc-200" {...props} />,
                           code: ({node, className, children, ...props}) => {
                              return <code className="bg-zinc-800/50 px-1.5 py-0.5 rounded text-xs font-mono text-zinc-300" {...props}>{children}</code>
                           }
                         }}
                       >
                         {msg.content}
                       </ReactMarkdown>
                     </div>
                  )}
                  {msg.isGenerating && (!msg.actions || msg.actions.length === 0) && (
                    <div className="flex items-center space-x-2 text-zinc-500 font-medium pb-2 my-2">
                       <Lightbulb className="w-4 h-4 text-amber-500/70 animate-pulse" />
                       <span>Thinking...</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-zinc-800/50 p-3 rounded-xl text-sm text-zinc-200 ml-auto w-fit max-w-[90%]">
                  {msg.content}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 w-full p-4 bg-transparent pt-0 z-10 pointer-events-none flex flex-col justify-end">
          <div className="pointer-events-auto">
            <div className="flex items-center space-x-1.5 text-xs text-white mb-3 px-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="drop-shadow-md">{input.trim().startsWith('/') ? 'Commands' : 'Suggestions'}</span>
              <span className="flex-1"></span>
              <span className="text-zinc-500 font-mono text-[10px] drop-shadow-md">{selectedModel}</span>
            </div>
          
          {input.trim().startsWith('/') ? (
            <div className="flex gap-2 overflow-x-auto mb-3 scrollbar-hide pb-1 min-h-[28px]">
              {'/model'.startsWith(input.toLowerCase()) && (
                <>
                  <button
                    onClick={() => { setSelectedModel('gemini-3.5-flash'); setInput(''); }}
                    className={`whitespace-nowrap px-4 py-1.5 ${selectedModel === 'gemini-3.5-flash' ? 'bg-[#404044] text-white' : 'bg-[#1e1e20] text-zinc-300'} hover:bg-[#2a2a2d] text-xs rounded-full transition-colors`}
                  >
                    Gemini 3.5 Flash
                  </button>
                  <button
                    onClick={() => { setSelectedModel('gemini-3.1-flash-lite'); setInput(''); }}
                    className={`whitespace-nowrap px-4 py-1.5 ${selectedModel === 'gemini-3.1-flash-lite' ? 'bg-[#404044] text-white' : 'bg-[#1e1e20] text-zinc-300'} hover:bg-[#2a2a2d] text-xs rounded-full transition-colors`}
                  >
                    Gemini 3.1 Flash Lite
                  </button>
                  <button
                    onClick={() => { setSelectedModel('nousresearch/hermes-3-llama-3.1-405b:free'); setInput(''); }}
                    className={`whitespace-nowrap px-4 py-1.5 ${selectedModel === 'nousresearch/hermes-3-llama-3.1-405b:free' ? 'bg-[#404044] text-white' : 'bg-[#1e1e20] text-zinc-300'} hover:bg-[#2a2a2d] text-xs rounded-full transition-colors`}
                  >
                    Hermes Agent
                  </button>
                  <button
                    onClick={() => { setSelectedModel('qwen/qwen3-coder:free'); setInput(''); }}
                    className={`whitespace-nowrap px-4 py-1.5 ${selectedModel === 'qwen/qwen3-coder:free' ? 'bg-[#404044] text-white' : 'bg-[#1e1e20] text-zinc-300'} hover:bg-[#2a2a2d] text-xs rounded-full transition-colors`}
                  >
                    Qwen 3 Coder
                  </button>
                  <button
                    onClick={() => { setSelectedModel('meta-llama/llama-3.3-70b-instruct:free'); setInput(''); }}
                    className={`whitespace-nowrap px-4 py-1.5 ${selectedModel === 'meta-llama/llama-3.3-70b-instruct:free' ? 'bg-[#404044] text-white' : 'bg-[#1e1e20] text-zinc-300'} hover:bg-[#2a2a2d] text-xs rounded-full transition-colors`}
                  >
                    Llama 3.3
                  </button>
                  <button
                    onClick={() => { setSelectedModel('openrouter/free'); setInput(''); }}
                    className={`whitespace-nowrap px-4 py-1.5 ${selectedModel === 'openrouter/free' ? 'bg-[#404044] text-white' : 'bg-[#1e1e20] text-zinc-300'} hover:bg-[#2a2a2d] text-xs rounded-full transition-colors`}
                  >
                    Auto (Free)
                  </button>
                </>
              )}
              {'/skills'.startsWith(input.toLowerCase()) && (
                <button
                  disabled
                  className="whitespace-nowrap px-4 py-1.5 bg-[#1e1e20] text-zinc-500 text-xs rounded-full cursor-not-allowed border border-[#1e1e20] opacity-80"
                >
                  /skills <span className="opacity-50 ml-1">Coming soon</span>
                </button>
              )}
              {!('/model'.startsWith(input.toLowerCase())) && !('/skills'.startsWith(input.toLowerCase())) && (
                <div className="text-xs text-zinc-500 px-2 py-1.5">No commands found matching &quot;{input}&quot;, try /model or /skills</div>
              )}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto mb-3 scrollbar-hide pb-1 min-h-[28px]">
              <button
                onClick={() => setInput('Add a dark mode toggle')}
                className="whitespace-nowrap px-4 py-1.5 bg-[#1e1e20] hover:bg-[#2a2a2d] text-zinc-300 text-xs rounded-full transition-colors"
              >
                Add dark mode
              </button>
              <button
                onClick={() => setInput('Create a user dashboard')}
                className="whitespace-nowrap px-4 py-1.5 bg-[#1e1e20] hover:bg-[#2a2a2d] text-zinc-300 text-xs rounded-full transition-colors"
              >
                User dashboard
              </button>
              <button
                onClick={() => setInput('Add a hero section')}
                className="whitespace-nowrap px-4 py-1.5 bg-[#1e1e20] hover:bg-[#2a2a2d] text-zinc-300 text-xs rounded-full transition-colors"
              >
                Hero section
              </button>
              <button
                onClick={() => setInput('Implement auth flow')}
                className="whitespace-nowrap px-4 py-1.5 bg-[#1e1e20] hover:bg-[#2a2a2d] text-zinc-300 text-xs rounded-full transition-colors"
              >
                Auth flow
              </button>
              <button
                onClick={() => setInput('Add analytics tracking')}
                className="whitespace-nowrap px-4 py-1.5 bg-[#1e1e20] hover:bg-[#2a2a2d] text-zinc-300 text-xs rounded-full transition-colors"
              >
                Analytics
              </button>
            </div>
          )}

          <div className="relative flex items-end bg-[#1e1e20] rounded-2xl overflow-hidden transition-colors">
            <button className="p-3 text-zinc-500 hover:text-zinc-300">
              <Paperclip className="w-5 h-5" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask a follow up..."
              className="flex-1 max-h-32 min-h-[44px] py-3 bg-transparent text-sm text-zinc-200 resize-none focus:outline-none placeholder:text-zinc-500"
              rows={1}
            />
            {isGenerating ? (
              <button
                onClick={handleStop}
                className="p-2 m-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-xl transition-colors"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-2 m-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors"
                title="Send message"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="text-[10px] text-zinc-600 font-mono mt-2 text-center drop-shadow-md">
            AI may produce false information.
          </div>
          </div>
        </div>
      </div>

      {/* Right Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0e0e10]">
        {/* Superior Top Bar */}
        <div className="h-12 border-b border-zinc-800 flex items-center px-4 justify-between bg-[#0e0e10]">
          <div className="flex items-center p-1 bg-[#151515] rounded-full">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center px-4 py-1.5 space-x-2 text-xs font-medium rounded-full transition-colors ${activeTab === 'preview' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Layout className="w-4 h-4" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center px-4 py-1.5 space-x-2 text-xs font-medium rounded-full transition-colors ${activeTab === 'code' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Code2 className="w-4 h-4" />
              <span>Code</span>
            </button>
          </div>

          <div className="flex items-center space-x-4 text-zinc-400">
            <button className="hover:text-zinc-200"><Monitor className="w-4 h-4" /></button>
            <button className="hover:text-zinc-200"><Download className="w-4 h-4" /></button>
            <button className="hover:text-zinc-200"><Share className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          
          {/* Browser Bar (Only visibly mainly in Preview, but we can keep it as an address bar) */}
          <div className="h-10 border-b border-zinc-800 bg-[#121214] flex items-center px-4 space-x-3 shrink-0">
            <div className="flex items-center space-x-2 text-zinc-500">
              <ChevronLeft className="w-4 h-4 hover:text-zinc-300 cursor-pointer" />
              <ChevronRight className="w-4 h-4 hover:text-zinc-300 cursor-pointer" />
              <RefreshCw className="w-4 h-4 hover:text-zinc-300 cursor-pointer" />
            </div>
            <div className="flex-1 bg-zinc-800/50 rounded-full px-3 py-1.5 max-w-xl mx-auto flex items-center justify-center text-xs text-zinc-400 font-mono truncate">
              {previewUrl}
            </div>
            <div className="w-16"></div> {/* Spacer to balance URL bar */}
          </div>

          <div className={`flex-1 ${activeTab === 'preview' ? 'flex' : 'hidden'}`}>
            <Preview files={currentFiles} onUrlChange={setPreviewUrl} />
          </div>

          <div className={`flex-1 bg-[#1e1e1e] overflow-hidden ${activeTab === 'code' ? 'flex' : 'hidden'}`}>
               {/* Code Explorer Left Pane */}
               <div className="w-64 border-r border-zinc-800 bg-[#181818] overflow-y-auto py-2 flex flex-col">
                 <div className="px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                   <span>Explorer</span>
                 </div>
                 <div className="flex-1">
                   {currentFiles.length === 0 ? (
                      <div className="px-4 text-sm text-zinc-500 mt-4">No files generated yet.</div>
                   ) : (
                     <ul className="text-sm">
                       {currentFiles.map((file) => {
                         const isSelected = selectedFile === file.path;
                         const Icon = file.path.endsWith('.json') ? FileJson 
                                    : file.path.match(/\.(tsx|ts)$/) ? FileCode2 
                                    : FileText;
  
                         return (
                           <li key={file.path}>
                             <button
                               onClick={() => setSelectedFile(file.path)}
                               className={`w-full flex items-center space-x-2 px-4 py-1.5 hover:bg-zinc-800/50 transition-colors ${
                                 isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                               }`}
                             >
                               <Icon className="w-4 h-4" />
                               <span className="truncate">{file.path}</span>
                             </button>
                           </li>
                         );
                       })}
                     </ul>
                   )}
                 </div>
               </div>
               
               {/* Code Editor Content */}
               <div className="flex-1 bg-[#1e1e1e] flex flex-col min-w-0">
                  {selectedFile ? (
                    <>
                      <div className="h-10 flex items-center justify-between px-4 bg-[#1e1e1e] border-b border-zinc-800 sticky top-0 shrink-0 text-sm text-zinc-400">
                        <span className="font-mono text-xs">{selectedFile}</span>
                        <button 
                          onClick={() => setIsSettingsOpen(true)}
                          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 relative">
                        <Editor
                          height="100%"
                          language={getLanguage(selectedFile)}
                          theme="vs-dark"
                          value={activeFileContent}
                          onChange={handleFileChange}
                          options={{
                            minimap: { enabled: editorSettings.minimap },
                            wordWrap: editorSettings.wordWrap ? 'on' : 'off',
                            fontLigatures: editorSettings.fontLigatures,
                            folding: editorSettings.folding,
                            lineNumbers: editorSettings.lineNumbers ? 'on' : 'off',
                            stickyScroll: { enabled: editorSettings.stickyScroll },
                            guides: { indentation: editorSettings.renderIndentGuides },
                            readOnly: false,
                            fontSize: 13,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
                      Select a file to view its contents.
                    </div>
                  )}
               </div>
            </div>

          {/* Bottom Console Panel */}
          <div className="h-10 border-t border-zinc-800 bg-[#0e0e10] flex items-center px-4 justify-between shrink-0">
            <button className="flex items-center space-x-2 text-xs text-zinc-400 hover:text-zinc-200">
              <Terminal className="w-4 h-4" />
              <span>Console</span>
            </button>
            <div className="flex space-x-3 text-xs">
               <span className="flex items-center space-x-1 text-emerald-500">
                 <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                 <span>Ready</span>
               </span>
            </div>
          </div>

        </div>
      </div>

      {/* Editor Settings Sidebar */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 w-80 h-full bg-[#181818] border-l border-zinc-800 shadow-2xl z-50 flex flex-col"
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Editor Settings</h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto space-y-6">
              <p className="text-xs text-zinc-400 mb-4">The following settings are available for your code editor.</p>
              
              <div className="space-y-4">
                {[
                  { id: 'wordWrap', title: 'Text wrapping', desc: 'The text wraps around the edges of the editor.' },
                  { id: 'fontLigatures', title: 'Font ligatures', desc: 'Render the text with font ligatures.' },
                  { id: 'minimap', title: 'Minimap', desc: 'Render the minimap with the file overview.' },
                  { id: 'folding', title: 'Folding', desc: 'Enable folding to collapse code blocks.' },
                  { id: 'lineNumbers', title: 'Line numbers', desc: 'Render the line numbers for each line of code.' },
                  { id: 'stickyScroll', title: 'Sticky scroll', desc: 'Enable sticky scroll to show the nested code blocks.' },
                  { id: 'renderIndentGuides', title: 'Render indentation guides', desc: 'Render indentation guides for each line of code.' }
                ].map((setting) => (
                  <div key={setting.id} className="flex items-start justify-between space-x-3">
                    <div className="flex-1">
                      <div className="text-sm text-zinc-200">{setting.title}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{setting.desc}</div>
                    </div>
                    <button
                      onClick={() => setEditorSettings(prev => ({ ...prev, [setting.id]: !prev[setting.id as keyof typeof editorSettings] }))}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                        editorSettings[setting.id as keyof typeof editorSettings] ? 'bg-zinc-200' : 'bg-zinc-700'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        editorSettings[setting.id as keyof typeof editorSettings] ? 'translate-x-2 bg-zinc-900' : '-translate-x-2'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
