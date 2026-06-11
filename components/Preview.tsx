import { useEffect, useRef, useState } from 'react';
import { Nodebox } from '@codesandbox/nodebox';
import { Monitor, Play, Terminal } from 'lucide-react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface FileNode {
  path: string;
  content: string;
}

interface PreviewProps {
  files: FileNode[];
  onUrlChange?: (url: string) => void;
}

// Keep global references to persist Nodebox across renders
let nodeboxInstance: Nodebox | null = null;
let nodeboxIframe: HTMLIFrameElement | null = null;
let bootingPromise: Promise<void> | null = null;
let isDevServerRunning = false;
let currentAppUrl: string | null = null;
let activeProcessObj: any = null;
let isFirstInitDev = true;
let previousFilesContent: Record<string, string> = {};

export function Preview({ files, onUrlChange }: PreviewProps) {
  const [url, setUrl] = useState<string | null>(currentAppUrl);
  const [status, setStatus] = useState<'idle' | 'booting' | 'mounting' | 'starting' | 'ready' | 'error'>(currentAppUrl ? 'ready' : 'idle');
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  
  const [debouncedFiles, setDebouncedFiles] = useState(files);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFiles(files), 1000);
    return () => clearTimeout(timer);
  }, [files]);

  useEffect(() => {
    if (url && onUrlChange) {
      onUrlChange(url);
    }
  }, [url, onUrlChange]);

  // Terminal initialization
  useEffect(() => {
    if ((status !== 'ready' && status !== 'idle' && status !== 'error') && terminalRef.current && !xtermRef.current) {
      const xterm = new Xterm({
        theme: {
          background: '#1e1e1e',
          foreground: '#a1a1aa',
          cursor: 'transparent',
          selectionBackground: '#3f3f46'
        },
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 12,
        disableStdin: true
      });
      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = xterm;

      window.addEventListener('resize', () => fitAddon.fit());
      
      // Write initial status
      xterm.write(`\x1b[1;34mℹ\x1b[0m Starting Nodebox environment...\r\n`);
    }
  }, [status]);

  useEffect(() => {
    let mounted = true;

    async function initAndRun() {
      if (debouncedFiles.length === 0) return;

      try {
        if (!nodeboxIframe) {
           nodeboxIframe = document.createElement('iframe');
           nodeboxIframe.style.display = 'none';
           document.body.appendChild(nodeboxIframe);
        }

        if (!nodeboxInstance) {
          setStatus('booting');
          nodeboxInstance = new Nodebox({
            iframe: nodeboxIframe
          });
          
          if (!bootingPromise) {
             bootingPromise = nodeboxInstance.connect();
          }
          await bootingPromise;
        }

        if (!mounted) return;

        setStatus(prev => prev === 'ready' ? 'ready' : 'mounting');
        
        const filesMap: Record<string, string> = {};
        for (const file of debouncedFiles) {
          const cleanPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
          filesMap[cleanPath] = file.content;
        }

        if (!isDevServerRunning) {
          // Initial sync of all files
          if (xtermRef.current) {
             xtermRef.current.write('\x1b[36mSyncing files...\x1b[0m\r\n');
          }
          await nodeboxInstance.fs.init(filesMap);
          previousFilesContent = filesMap;
        } else {
          // Write only changed files
          for (const [path, content] of Object.entries(filesMap)) {
             if (previousFilesContent[path] !== content) {
                // Nodebox expects intermediate directories to exist sometimes, but vite/nodebox handles it gracefully
                try {
                  await nodeboxInstance.fs.writeFile(path, content);
                } catch(e) {
                   // Ignore write failures gracefully
                }
                previousFilesContent[path] = content;
             }
          }
          
          // Remove deleted files
          for (const path of Object.keys(previousFilesContent)) {
             if (!(path in filesMap)) {
                try {
                   await nodeboxInstance.fs.rm(path);
                } catch(e) {}
                delete previousFilesContent[path];
             }
          }
        }

        const handleLog = (data: string) => {
          if (!mounted) return;
          if (xtermRef.current) {
            xtermRef.current.write(data);
          }
        };

        if (!isDevServerRunning) {
          isDevServerRunning = true;
          if (!mounted) return;
          
          setStatus('starting');
          if (xtermRef.current) xtermRef.current.write('\r\n\x1b[1;33m▶\x1b[0m npm run dev\r\n');
          
          const shell = nodeboxInstance.shell.create();
          activeProcessObj = shell;
          
          activeProcessObj.stdout.on('data', (data: string[]) => {
            handleLog(data.toString().replace(/\n/g, '\r\n'));
          });
          
          activeProcessObj.stderr.on('data', (data: string[]) => {
             handleLog(data.toString().replace(/\n/g, '\r\n'));
          });

          const devProcessInfo = await activeProcessObj.runCommand('npm', ['run', 'dev']);
          const previewInfo = await nodeboxInstance.preview.getByShellId(devProcessInfo.id);
          
          currentAppUrl = previewInfo.url;
          if (mounted) {
            setUrl(currentAppUrl);
            setStatus('ready');
          }
        } else if (status !== 'ready' && currentAppUrl) {
          setStatus('ready');
          setUrl(currentAppUrl);
        }

      } catch (err: any) {
        if (mounted) {
          setStatus('error');
          if (xtermRef.current) xtermRef.current.write(`\r\n\x1b[31;1mError: ${err.message}\x1b[0m\r\n`);
        }
      }
    }

    initAndRun();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFiles]);

  if (files.length === 0) {
    return (
      <div className="flex-1 bg-white flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <Play className="w-12 h-12 mx-auto mb-4 text-zinc-300" />
          <p>Generate an app to see the preview.</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
     return (
       <div className="flex-1 bg-[#1e1e1e] flex flex-col items-center justify-center p-6 text-red-400">
          <div className="max-w-xl w-full bg-red-950/30 border border-red-900 rounded-lg p-4">
             <h3 className="font-semibold mb-2 flex items-center gap-2"><Terminal className="w-4 h-4"/> Error occurred</h3>
             <div className="space-y-1 text-sm font-mono mt-4">
                 Please check the terminal logs or try reloading the application.
             </div>
          </div>
       </div>
     );
  }

  if (status !== 'ready' || !url) {
    return (
      <div className="flex-1 bg-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-[#1e1e1e] rounded-lg shadow-xl overflow-hidden border border-zinc-800">
           <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#18181b]">
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                 <Monitor className="w-4 h-4 text-zinc-400" />
               </div>
               <div>
                  <div className="text-sm font-medium text-zinc-200">Nodebox Sandbox</div>
                  <div className="text-xs text-zinc-500 capitalize">{status}...</div>
               </div>
             </div>
             <div className="w-4 h-4 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin"></div>
           </div>
           
           {/* Terminal Output Area */}
           <div className="p-3 bg-[#1e1e1e] h-64">
             <div ref={terminalRef} className="w-full h-full" />
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white relative w-full h-full">
      <iframe 
        ref={previewIframeRef}
        src={url}
        className="w-full h-full border-0 bg-white"
        title="App Preview"
        allow="cross-origin-isolated"
      />
    </div>
  );
}

