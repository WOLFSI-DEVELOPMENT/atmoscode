import { useEffect, useState, useMemo } from 'react';
import { Play, ShieldAlert, FileCode2 } from 'lucide-react';

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

export function Preview({ files, onUrlChange, previewKey = 0 }: PreviewProps) {
  const [selectedHtmlPath, setSelectedHtmlPath] = useState<string>('index.html');

  // List all available HTML files for tab selection
  const htmlFiles = useMemo(() => {
    return files.filter(f => f.path.endsWith('.html'));
  }, [files]);

  // Determine the actual path to render
  const currentHtmlPath = useMemo(() => {
    const exists = htmlFiles.some(f => f.path === selectedHtmlPath);
    if (exists) return selectedHtmlPath;
    
    // Fallback: index.html or the first available html file
    const indexFile = htmlFiles.find(f => f.path === 'index.html');
    return indexFile ? 'index.html' : (htmlFiles[0]?.path || 'index.html');
  }, [htmlFiles, selectedHtmlPath]);

  // Sync virtual address display in parent editor bar
  useEffect(() => {
    if (onUrlChange) {
      onUrlChange(`sandbox://authority/${currentHtmlPath}`);
    }
  }, [onUrlChange, currentHtmlPath]);

  // Listen to navigation events from the sandboxed iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'NAVIGATE') {
        const rawPath = event.data.path;
        
        // Clean simple directory resolution
        const parts = currentHtmlPath.split('/');
        parts.pop(); // remove file name
        
        const targetParts = rawPath.replace(/^\.?\//, '').split('/');
        const finalParts = [...parts];
        for (const p of targetParts) {
          if (p === '..') {
            finalParts.pop();
          } else if (p !== '.' && p !== '') {
            finalParts.push(p);
          }
        }
        
        let path = finalParts.join('/');
        if (!path.endsWith('.html') && !path.includes('.')) {
          path = path ? `${path}.html` : 'index.html';
        }

        const matched = files.find(f => f.path === path || f.path === `${path}/index.html`);
        if (matched) {
          setSelectedHtmlPath(matched.path);
        } else {
          // Simple suffix matching
          const fallback = files.find(f => f.path.endsWith(path));
          if (fallback) {
            setSelectedHtmlPath(fallback.path);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [files, currentHtmlPath]);

  // Compile active page content with resource injection
  const htmlContent = useMemo(() => {
    if (files.length === 0) return '';

    const activeFile = files.find(f => f.path === currentHtmlPath);
    if (!activeFile) return '';

    let content = activeFile.content;

    // 1. Surgical injection of relative stylesheet file contents
    const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
    content = content.replace(linkRegex, (match, href) => {
      const cleanHref = href.replace(/^\.?\//, '');
      const cssFile = files.find(f => f.path.replace(/^\.?\//, '') === cleanHref);
      if (cssFile) {
        return `<style>\n${cssFile.content}\n</style>`;
      }
      return match;
    });

    // 2. Surgical injection of relative script file contents
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
    content = content.replace(scriptRegex, (match, src) => {
      const cleanSrc = src.replace(/^\.?\//, '');
      const jsFile = files.find(f => f.path.replace(/^\.?\//, '') === cleanSrc);
      if (jsFile) {
        return `<script>\n${jsFile.content}\n</script>`;
      }
      return match;
    });

    // 3. Inject micro-routing interception script
    const injectRouterScript = `
<script id="preview-navigation-interceptor">
document.addEventListener('click', function(e) {
  const link = e.target.closest('a');
  if (link) {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('http:') && !href.startsWith('https:') && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('data:')) {
      e.preventDefault();
      window.parent.postMessage({ type: 'NAVIGATE', path: href }, '*');
    }
  }
});
</script>
`;
    // Append routing script before closing body tag
    if (content.includes('</body>')) {
      content = content.replace('</body>', `${injectRouterScript}\n</body>`);
    } else {
      content = content + injectRouterScript;
    }

    return content;
  }, [files, currentHtmlPath]);

  if (files.length === 0) {
    return (
      <div className="flex-1 bg-[#0a0a0a] flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <Play className="w-12 h-12 mx-auto mb-4 text-[#404044]" />
          <p className="text-sm">Generate an app to see the preview.</p>
        </div>
      </div>
    );
  }

  if (!htmlContent) {
    return (
      <div className="flex-1 bg-[#0a0a0a] flex flex-col items-center justify-center p-6 text-zinc-400">
        <div className="max-w-xl w-full bg-[#111113] border border-zinc-800 rounded-lg p-6">
          <h3 className="font-semibold mb-2 flex items-center gap-2 text-white">
            <ShieldAlert className="w-5 h-5 text-zinc-500" />
            No active file found
          </h3>
          <p className="text-sm text-zinc-400 mt-2">
            Workspace lacks an appropriate <code>.html</code> rendering entrypoint.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#0a0a0a] relative w-full h-full flex flex-col">
      {/* Dynamic Sub-Page Navigation Tab Bar */}
      {htmlFiles.length > 1 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111113] border-b border-zinc-800 overflow-x-auto scrollbar-hide">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2 font-semibold">Pages:</span>
          {htmlFiles.map(f => (
            <button
              key={f.path}
              onClick={() => setSelectedHtmlPath(f.path)}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-xs transition-colors ${
                currentHtmlPath === f.path
                  ? 'bg-[#1e1e20] text-white border border-zinc-700/50'
                  : 'bg-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileCode2 className="w-3 h-3 text-zinc-500" />
              {f.path}
            </button>
          ))}
        </div>
      )}

      {/* Main sandboxed viewframe */}
      <iframe
        key={previewKey}
        srcDoc={htmlContent}
        className="w-full h-full border-0 bg-white"
        title="App Preview"
        sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
      />
    </div>
  );
}

