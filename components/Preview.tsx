import { useEffect, useRef, useState } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Monitor, Play, Terminal, Loader2 } from 'lucide-react';

interface FileNode {
  path: string;
  content: string;
}

interface PreviewProps {
  files: FileNode[];
  onUrlChange?: (url: string) => void;
  previewKey?: number;
  restartKey?: number;
}

// Keep global references to persist WebContainer across renders
let webcontainerInstance: WebContainer | null = null;
let bootingPromise: Promise<WebContainer> | null = null;
let isDevServerRunning = false;
let currentAppUrl: string | null = null;
let activeProcessObj: any = null;
let previousFilesContent: Record<string, string> = {};

function buildFileSystemTree(files: FileNode[]) {
  const tree: Record<string, any> = {};
  for (const file of files) {
    const parts = file.path.replace(/^\//, '').split('/');
    const fileName = parts.pop()!;
    let current = tree;
    for (const part of parts) {
      if (!current[part]) {
        current[part] = { directory: {} };
      }
      if (!current[part].directory) {
          current[part].directory = {};
      }
      current = current[part].directory;
    }
    current[fileName] = { file: { contents: file.content } };
  }
  return tree;
}

export function Preview({ files, onUrlChange, previewKey = 0, restartKey = 0 }: PreviewProps) {
  const [url, setUrl] = useState<string | null>(currentAppUrl);
  const [status, setStatus] = useState<'idle' | 'booting' | 'mounting' | 'installing' | 'starting' | 'ready' | 'error'>(currentAppUrl ? 'ready' : 'idle');
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  
  const [debouncedFiles, setDebouncedFiles] = useState(files);
  const xtermRef = useRef<{ write: (s: string) => void }>({ write: () => {} });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFiles(files), 1000);
    return () => clearTimeout(timer);
  }, [files]);

  useEffect(() => {
    if (url && onUrlChange) {
      onUrlChange(url);
    }
  }, [url, onUrlChange]);

  // Terminal initialization removed as per user request

  useEffect(() => {
    if (restartKey > 0 && webcontainerInstance && activeProcessObj) {
      const restart = async () => {
        try {
          setStatus('starting');
          activeProcessObj.kill();
          if (xtermRef.current) xtermRef.current.write('\r\n\x1b[1;33m▶\x1b[0m Restarting dev server (npm run dev)...\r\n');
          
          activeProcessObj = await webcontainerInstance!.spawn('npm', ['run', 'dev']);
          activeProcessObj.output.pipeTo(new WritableStream({
             write(data) { 
               if (xtermRef.current) xtermRef.current.write(data); 
             }
          }));
          setStatus('ready');
        } catch(e) {
          console.error(e);
        }
      };
      restart();
    }
  }, [restartKey]);

  useEffect(() => {
    let mounted = true;

    async function initAndRun() {
      if (debouncedFiles.length === 0) return;

      try {
        if (!webcontainerInstance) {
          setStatus('booting');
          if (!bootingPromise) {
             bootingPromise = WebContainer.boot();
          }
          webcontainerInstance = await bootingPromise;
          
          webcontainerInstance.on('server-ready', (port, url) => {
            currentAppUrl = url;
            setUrl(url);
            setStatus('ready');
          });
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
          const tree = buildFileSystemTree(debouncedFiles);
          await webcontainerInstance.mount(tree);
          previousFilesContent = filesMap;
        } else {
          // Write only changed files
          for (const [path, content] of Object.entries(filesMap)) {
             if (previousFilesContent[path] !== content) {
                try {
                  const parts = path.split('/');
                  const fileName = parts.pop()!;
                  if (parts.length > 0) {
                     await webcontainerInstance.fs.mkdir(parts.join('/'), { recursive: true });
                  }
                  await webcontainerInstance.fs.writeFile(path, content);
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
                   await webcontainerInstance.fs.rm(path);
                } catch(e) {}
                delete previousFilesContent[path];
             }
          }
        }

        const handleLog = (data: string) => {
          if (xtermRef.current) {
            xtermRef.current.write(data);
          }
        };

        if (!isDevServerRunning) {
          isDevServerRunning = true;
          
          // Install dependencies
          setStatus('installing');
          if (xtermRef.current) xtermRef.current.write('\r\n\x1b[1;33m▶\x1b[0m npm install\r\n');
          
          const installProcess = await webcontainerInstance.spawn('npm', ['install']);
          installProcess.output.pipeTo(new WritableStream({
            write(data) { handleLog(data); }
          }));
          
          const installExitCode = await installProcess.exit;
          if (installExitCode !== 0) {
             isDevServerRunning = false;
             throw new Error('Installation failed');
          }

          setStatus('starting');
          if (xtermRef.current) xtermRef.current.write('\r\n\x1b[1;33m▶\x1b[0m npm run dev\r\n');
          
          activeProcessObj = await webcontainerInstance.spawn('npm', ['run', 'dev']);
          activeProcessObj.output.pipeTo(new WritableStream({
             write(data) { handleLog(data); }
          }));
        } else if (currentAppUrl) {
          setStatus('ready');
          setUrl(currentAppUrl);
        }

      } catch (err: any) {
        setStatus('error');
        if (xtermRef.current) xtermRef.current.write(`\r\n\x1b[31;1mError: ${err.message}\x1b[0m\r\n`);
      }
    }

    initAndRun();

    return () => {
      mounted = false;
    };
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
    const progressMap: Record<string, number> = {
      idle: 0,
      booting: 20,
      mounting: 40,
      installing: 70,
      starting: 90,
      ready: 100,
      error: 100
    };
    const progress = progressMap[status] || 0;

    return (
      <div className="flex-1 bg-white flex flex-col items-center justify-center p-6 text-zinc-800">
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-zinc-400" />
        <h3 className="text-xl font-medium mb-6">Building your preview</h3>
        
        <div className="w-64 h-1 bg-zinc-200 rounded-full overflow-hidden mb-3">
           <div 
             className="h-full bg-zinc-800 transition-all duration-500 ease-out"
             style={{ width: `${progress}%` }}
           />
        </div>

        <p className="text-sm font-medium text-zinc-500">
           {status === 'booting' && 'Starting environment...'}
           {status === 'mounting' && 'Syncing files...'}
           {status === 'installing' && 'Installing dependencies...'}
           {status === 'starting' && 'Starting development server...'}
           {status === 'idle' && 'Preparing...'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white relative w-full h-full">
      <iframe 
        key={previewKey}
        ref={previewIframeRef}
        src={url}
        className="w-full h-full border-0 bg-white"
        title="App Preview"
        allow="cross-origin-isolated"
      />
    </div>
  );
}

