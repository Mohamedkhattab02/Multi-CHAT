'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Copy, Check, WrapText, Code2, Eye, ExternalLink } from 'lucide-react';
import { useCodePanelStore, MIN_WIDTH, MAX_WIDTH } from '@/lib/store/code-panel-store';

// ─── Language sets ───────────────────────────────────────────────
const HTML_RENDERABLE = new Set(['html', 'svg', 'xml']);
const REACT_RENDERABLE = new Set(['tsx', 'jsx']);
const CSS_RENDERABLE = new Set(['css', 'scss', 'less']);
const MARKDOWN_RENDERABLE = new Set(['md', 'markdown']);
const JSON_RENDERABLE = new Set(['json']);
const MERMAID_RENDERABLE = new Set(['mermaid']);

function isPreviewable(lang: string | undefined): boolean {
  if (!lang) return false;
  return (
    HTML_RENDERABLE.has(lang) || REACT_RENDERABLE.has(lang) ||
    CSS_RENDERABLE.has(lang) || MARKDOWN_RENDERABLE.has(lang) ||
    JSON_RENDERABLE.has(lang) || MERMAID_RENDERABLE.has(lang)
  );
}

// ─── Shared base styles for all previews ────────────────────────
const BASE_STYLES = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
`;

const BASE_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"/>`;

// ─── HTML Preview ───────────────────────────────────────────────
function buildHtmlPreview(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.tailwindcss.com"><\/script>
${BASE_FONTS}
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
<style>
${BASE_STYLES}
body{font-family:'Inter',system-ui,sans-serif;line-height:1.6;color:#e2e8f0;background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);min-height:100vh;padding:32px}
img,svg{max-width:100%;height:auto;display:block}
a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline;color:#93bbfd}
h1{font-size:2.25rem;font-weight:800;line-height:1.2;letter-spacing:-0.025em;margin-bottom:0.5em;color:#f1f5f9}
h2{font-size:1.75rem;font-weight:700;line-height:1.3;margin-bottom:0.5em;color:#e2e8f0}
h3{font-size:1.25rem;font-weight:600;line-height:1.4;margin-bottom:0.4em;color:#cbd5e1}
p{margin-bottom:1em;color:#94a3b8}
ul,ol{padding-left:1.5em;margin-bottom:1em;color:#94a3b8}
li{margin-bottom:0.25em}
table{width:100%;border-collapse:collapse;margin-bottom:1em;border-radius:8px;overflow:hidden}
th,td{padding:12px 16px;border:1px solid #334155;text-align:left}
th{background:#1e293b;font-weight:600;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#60a5fa}
td{background:#0f172a}
input,textarea,select{font-family:inherit;font-size:1rem;padding:10px 14px;border:1px solid #334155;border-radius:10px;outline:none;background:#1e293b;color:#e2e8f0;transition:all 0.2s}
input:focus,textarea:focus,select:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.2)}
button{font-family:inherit;cursor:pointer;padding:10px 20px;border-radius:10px;border:1px solid #334155;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-weight:600;transition:all 0.2s}
button:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(59,130,246,0.3)}
code{font-family:'SF Mono','Cascadia Code','Fira Code',monospace;font-size:0.88em;background:#1e293b;padding:3px 8px;border-radius:6px;color:#a78bfa;border:1px solid #334155}
pre{background:#0f172a;color:#e2e8f0;padding:20px 24px;border-radius:12px;overflow-x:auto;margin-bottom:1em;border:1px solid #1e293b}
pre code{background:none;padding:0;color:inherit;border:none}
blockquote{border-left:4px solid #3b82f6;padding:16px 24px;margin:0 0 1em;background:rgba(59,130,246,0.08);border-radius:0 10px 10px 0;color:#93c5fd}
hr{border:none;border-top:1px solid #334155;margin:2em 0}
.card,.container,.wrapper,.box,.panel,.section{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
</style>
</head>
<body>${code}</body>
</html>`;
}

// ─── React TSX/JSX Preview ──────────────────────────────────────
function buildReactPreview(code: string): string {
  // Only strip import/export lines — let Babel handle ALL TypeScript syntax
  const lines = code.split('\n');
  const cleaned = lines
    .filter(line => {
      const trimmed = line.trim();
      // Remove import statements
      if (/^import\s/.test(trimmed)) return false;
      // Remove 'use client' / 'use server' directives
      if (/^['"]use (client|server)['"];?\s*$/.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    // Convert export default function → function
    .replace(/^export\s+default\s+function\s+/gm, 'function ')
    // Convert export default const → const __DefaultExport__ =
    .replace(/^export\s+default\s+/gm, 'const __DefaultExport__ = ')
    // Convert named exports → plain declarations
    .replace(/^export\s+(function|const|let|var|class|enum)\s+/gm, '$1 ')
    // Remove standalone export type / export interface (TS only)
    .replace(/^export\s+(type|interface)\s+/gm, '$1 ');

  // Use JSON.stringify to safely embed code — no template literal escaping issues
  const safeCode = JSON.stringify(cleaned);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
${BASE_FONTS}
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
<style>
${BASE_STYLES}
body{font-family:'Inter',system-ui,sans-serif;color:#e2e8f0;background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);min-height:100vh;padding:0}
#root{min-height:100vh}
.preview-error{color:#fca5a5;background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:12px;padding:20px 24px;margin:24px;font-size:13px;font-family:'SF Mono','Cascadia Code',monospace;white-space:pre-wrap;line-height:1.7;backdrop-filter:blur(8px)}
.preview-error b{display:block;margin-bottom:10px;font-size:15px;color:#f87171}
.preview-loading{display:flex;align-items:center;justify-content:center;min-height:100vh;color:#64748b;font-size:14px}
</style>
</head>
<body>
<div id="root"><div class="preview-loading">Loading preview...</div></div>
<script>
// Load dependencies in order, then run preview
function loadScript(src, cb) {
  var s = document.createElement('script');
  s.src = src;
  s.onload = cb;
  s.onerror = function() { cb(new Error('Failed to load: ' + src)); };
  document.head.appendChild(s);
}

loadScript('https://unpkg.com/react@18/umd/react.production.min.js', function(e1) {
  if (e1) { showError(e1); return; }
  loadScript('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', function(e2) {
    if (e2) { showError(e2); return; }
    loadScript('https://unpkg.com/@babel/standalone@7/babel.min.js', function(e3) {
      if (e3) { showError(e3); return; }
      loadScript('https://cdn.tailwindcss.com', function() {
        runPreview();
      });
    });
  });
});

function showError(err) {
  document.getElementById('root').innerHTML = '<div class="preview-error"><b>Preview Error</b>' + String(err.message || err).replace(/</g, '&lt;') + '</div>';
}

function runPreview() {
  try {
    var codeStr = ${safeCode};

    // Transpile with Babel — TypeScript + JSX preset handles everything
    var output = Babel.transform(codeStr, {
      presets: [
        ['react', { runtime: 'classic' }],
        ['typescript', { isTSX: true, allExtensions: true }]
      ],
      filename: 'preview.tsx',
    }).code;

    // Provide React hooks and utilities in the execution scope
    var execScope = {
      React: React,
      ReactDOM: ReactDOM,
      useState: React.useState,
      useEffect: React.useEffect,
      useRef: React.useRef,
      useMemo: React.useMemo,
      useCallback: React.useCallback,
      useContext: React.useContext,
      useReducer: React.useReducer,
      useLayoutEffect: React.useLayoutEffect,
      useId: React.useId,
      createContext: React.createContext,
      forwardRef: React.forwardRef,
      memo: React.memo,
      Fragment: React.Fragment,
      createElement: React.createElement,
      cloneElement: React.cloneElement,
      Children: React.Children,
      createPortal: ReactDOM.createPortal,
      module: { exports: {} },
      exports: {},
      require: function() { return {}; },
      console: window.console,
    };
    execScope.exports = execScope.module.exports;

    // Build function params
    var paramNames = Object.keys(execScope);
    var paramValues = paramNames.map(function(k) { return execScope[k]; });

    var fn = new Function(paramNames.join(','), output);
    fn.apply(null, paramValues);

    // Find the component to render
    var RootComponent = null;

    // Check module.exports
    var mod = execScope.module.exports;
    if (mod && mod.__esModule && typeof mod.default === 'function') {
      RootComponent = mod.default;
    } else if (typeof mod === 'function') {
      RootComponent = mod;
    }

    // Search well-known names + any PascalCase function detected in code
    if (!RootComponent) {
      // Extract all PascalCase identifiers from code
      var allNames = ['__DefaultExport__'];
      var nameRegex = /(?:function|const|let|var|class)\\s+([A-Z][a-zA-Z0-9]*)/g;
      var m;
      while ((m = nameRegex.exec(codeStr)) !== null) {
        if (allNames.indexOf(m[1]) === -1) allNames.push(m[1]);
      }
      // Also check common names
      ['App','Component','Main','Page','Home','Demo','Card','Header','Hero',
       'Button','Form','Dashboard','Layout','Sidebar','Nav','Navbar','Footer',
       'Modal','Dialog','Widget','Panel','Section','Counter','Todo','List',
       'Table','Chart','Profile','Login','Signup','Landing','Example','Preview'].forEach(function(n) {
        if (allNames.indexOf(n) === -1) allNames.push(n);
      });

      for (var i = 0; i < allNames.length; i++) {
        try {
          var c = eval(allNames[i]);
          if (typeof c === 'function') { RootComponent = c; break; }
        } catch(ex) {}
      }
    }

    if (RootComponent) {
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement(RootComponent)
      );
    } else {
      document.getElementById('root').innerHTML =
        '<div class="preview-error"><b>No component found</b>' +
        'Define a React component with one of these patterns:\\n\\n' +
        '  export default function App() { ... }\\n' +
        '  function MyComponent() { ... }\\n' +
        '  const Card = () => { ... }</div>';
    }
  } catch (err) {
    showError(err);
  }
}
<\/script>
</body>
</html>`;
}

// ─── CSS Preview ────────────────────────────────────────────────
function buildCSSPreview(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
${BASE_FONTS}
<style>
${BASE_STYLES}
body{font-family:'Inter',system-ui,sans-serif;padding:32px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);color:#e2e8f0;line-height:1.6;min-height:100vh}
.demo-section{margin-bottom:32px}
.demo-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:12px}
.demo-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
${code}
</style>
</head>
<body>
<div class="demo-section"><div class="demo-label">Typography</div>
<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>
<p>Paragraph text with <strong>bold</strong>, <em>italic</em>, and <a href="#">link</a> styling.</p>
</div>
<div class="demo-section"><div class="demo-label">Buttons</div><div class="demo-row">
<button class="btn btn-primary primary">Primary</button>
<button class="btn btn-secondary secondary">Secondary</button>
<button class="btn btn-outline outline">Outline</button>
<button disabled>Disabled</button>
</div></div>
<div class="demo-section"><div class="demo-label">Card</div>
<div class="card"><h3>Card Title</h3><p>Card content with some text inside.</p></div>
</div>
<div class="demo-section"><div class="demo-label">Form Elements</div><div class="demo-row" style="flex-direction:column;align-items:stretch;max-width:320px">
<input type="text" placeholder="Text input"/><select><option>Select option</option></select><textarea placeholder="Textarea" rows="2"></textarea>
</div></div>
<div class="demo-section"><div class="demo-label">List</div>
<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>
</div>
<div class="demo-section"><div class="demo-label">Alerts &amp; Badges</div>
<div class="alert alert-success success" style="margin-bottom:8px">Success message</div>
<div class="alert alert-error error danger" style="margin-bottom:8px">Error message</div>
<div class="demo-row" style="margin-top:12px"><span class="badge badge-primary tag">Badge</span><span class="badge badge-secondary">Secondary</span></div>
</div>
</body>
</html>`;
}

// ─── Markdown Preview ───────────────────────────────────────────
function buildMarkdownPreview(code: string): string {
  const escaped = JSON.stringify(code);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
${BASE_FONTS}
<style>
${BASE_STYLES}
body{font-family:'Inter',system-ui,sans-serif;padding:40px;color:#e2e8f0;background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);line-height:1.7;max-width:780px;min-height:100vh}
h1{font-size:2em;font-weight:800;border-bottom:2px solid #334155;padding-bottom:0.4em;margin:1.5em 0 0.6em;color:#f1f5f9;letter-spacing:-0.02em}
h2{font-size:1.5em;font-weight:700;border-bottom:1px solid #1e293b;padding-bottom:0.3em;margin:1.4em 0 0.5em;color:#e2e8f0}
h3{font-size:1.2em;font-weight:600;margin:1.2em 0 0.4em;color:#cbd5e1}
p{margin-bottom:1em;color:#94a3b8}
a{color:#60a5fa;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}
pre{background:#0f172a;color:#e2e8f0;padding:20px 24px;border-radius:12px;overflow-x:auto;margin:1em 0;font-size:0.9em;line-height:1.6;border:1px solid #1e293b}
code{font-family:'SF Mono','Cascadia Code','Fira Code',monospace;background:#1e293b;padding:3px 8px;border-radius:6px;font-size:0.88em;color:#a78bfa}
pre code{background:none;padding:0;color:inherit}
blockquote{border-left:4px solid #3b82f6;padding:16px 24px;margin:1em 0;background:rgba(59,130,246,0.08);border-radius:0 10px 10px 0;color:#93c5fd}
table{width:100%;border-collapse:collapse;margin:1em 0;border-radius:8px;overflow:hidden}
th,td{padding:12px 16px;border:1px solid #334155;text-align:left}
th{background:#1e293b;font-weight:600;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#60a5fa}
td{background:#0f172a}
img{max-width:100%;border-radius:10px}
hr{border:none;border-top:1px solid #334155;margin:2em 0}
ul,ol{padding-left:1.6em;margin-bottom:1em;color:#94a3b8}li{margin-bottom:0.3em}
</style>
</head>
<body>
<div id="content"></div>
<script>
try{document.getElementById('content').innerHTML=marked.parse(${escaped})}
catch(e){document.getElementById('content').innerText='Parse error: '+e.message}
<\/script>
</body>
</html>`;
}

// ─── JSON Tree View ─────────────────────────────────────────────
function buildJSONPreview(code: string): string {
  const escaped = JSON.stringify(code);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"/>
<style>
${BASE_STYLES}
body{font-family:'JetBrains Mono','SF Mono',monospace;padding:24px;font-size:13px;color:#e2e8f0;background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);line-height:1.7;min-height:100vh}
.json-key{color:#60a5fa;font-weight:600}
.json-string{color:#34d399}
.json-number{color:#f472b6}
.json-boolean{color:#fbbf24;font-weight:500}
.json-null{color:#64748b;font-style:italic}
.json-bracket{color:#94a3b8}
.collapsible{cursor:pointer;user-select:none;border-radius:4px;padding:1px 4px}
.collapsible:hover{background:rgba(59,130,246,0.15)}
.collapsed>.json-children{display:none}
.collapsed>.json-ellipsis{display:inline}
.json-ellipsis{display:none;color:#64748b;font-style:italic}
.json-children{padding-left:24px;border-left:1px solid #334155;margin-left:2px}
.json-line{line-height:1.8}
.json-count{color:#64748b;font-size:11px;margin-left:6px;font-weight:400}
.error{color:#fca5a5;background:rgba(220,38,38,0.1);padding:16px;border-radius:10px;border:1px solid rgba(220,38,38,0.3);font-size:13px}
.toggle-all{position:fixed;top:16px;right:20px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:6px 14px;font-size:11px;cursor:pointer;font-family:inherit;color:#94a3b8;transition:all 0.2s}
.toggle-all:hover{background:#334155;color:#e2e8f0}
</style>
</head>
<body>
<button class="toggle-all" onclick="toggleAll()">Toggle All</button>
<div id="root"></div>
<script>
var allCollapsed=false;
function toggleAll(){allCollapsed=!allCollapsed;document.querySelectorAll('.json-node').forEach(function(n){allCollapsed?n.classList.add('collapsed'):n.classList.remove('collapsed')})}
function renderJSON(data,key,isLast){
if(data===null)return'<span class="json-null">null</span>'+(isLast?'':',');
if(typeof data==='boolean')return'<span class="json-boolean">'+data+'</span>'+(isLast?'':',');
if(typeof data==='number')return'<span class="json-number">'+data+'</span>'+(isLast?'':',');
if(typeof data==='string')return'<span class="json-string">"'+data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')+'"</span>'+(isLast?'':',');
var isArr=Array.isArray(data);var entries=isArr?data.map(function(v,i){return[i,v]}):Object.entries(data);
var open=isArr?'[':'{';var close=isArr?']':'}';var count=entries.length;
if(count===0)return'<span class="json-bracket">'+open+close+'</span>'+(isLast?'':',');
var h='<span class="json-node">';
h+='<span class="collapsible" onclick="this.parentElement.classList.toggle(\'collapsed\')">';
h+='<span class="json-bracket">'+open+'</span>';
h+='<span class="json-count">'+count+(isArr?' items':' keys')+'</span>';
h+='<span class="json-ellipsis"> ... '+close+'</span>';
h+='</span>';
h+='<div class="json-children">';
entries.forEach(function(e,i){var last=i===entries.length-1;h+='<div class="json-line">';if(!isArr)h+='<span class="json-key">"'+e[0]+'"</span>: ';h+=renderJSON(e[1],e[0],last);h+='</div>'});
h+='</div><span class="json-bracket">'+close+'</span>'+(isLast?'':',');
h+='</span>';return h}
try{var d=JSON.parse(${escaped});document.getElementById('root').innerHTML='<div class="json-line">'+renderJSON(d,null,true)+'</div>'}
catch(e){document.getElementById('root').innerHTML='<div class="error">Invalid JSON: '+e.message+'</div>'}
<\/script>
</body>
</html>`;
}

// ─── Mermaid Diagram ────────────────────────────────────────────
function buildMermaidPreview(code: string): string {
  const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
<style>
${BASE_STYLES}
body{display:flex;justify-content:center;align-items:flex-start;padding:40px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);min-height:100vh}
#diagram{width:100%;max-width:900px}
.error{color:#fca5a5;background:rgba(220,38,38,0.1);padding:16px;border-radius:12px;border:1px solid rgba(220,38,38,0.3);font-family:monospace;font-size:13px}
</style>
</head>
<body>
<div id="diagram"><pre class="mermaid">${escaped}</pre></div>
<script>mermaid.initialize({startOnLoad:true,theme:'dark',securityLevel:'loose'})<\/script>
</body>
</html>`;
}

// ─── Get preview HTML for a given language ──────────────────────
function getPreviewHtml(code: string, language: string): string | null {
  if (HTML_RENDERABLE.has(language)) return buildHtmlPreview(code);
  if (REACT_RENDERABLE.has(language)) return buildReactPreview(code);
  if (CSS_RENDERABLE.has(language)) return buildCSSPreview(code);
  if (MARKDOWN_RENDERABLE.has(language)) return buildMarkdownPreview(code);
  if (JSON_RENDERABLE.has(language)) return buildJSONPreview(code);
  if (MERMAID_RENDERABLE.has(language)) return buildMermaidPreview(code);
  return null;
}

// ─── Hooks ──────────────────────────────────────────────────────
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// ─── Component ──────────────────────────────────────────────────
export function CodeSidePanel() {
  const { isOpen, code, language, title, width, closePanel, setWidth } = useCodePanelStore();
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState('');
  const [wordWrap, setWordWrap] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const panelRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDarkMode();

  const canPreview = isPreviewable(language || undefined);

  // Auto-switch to preview tab for previewable languages
  useEffect(() => {
    if (isOpen) setActiveTab(canPreview ? 'preview' : 'code');
  }, [isOpen, code, canPreview]);

  // Syntax highlight
  useEffect(() => {
    if (!isOpen || !code) { setHighlighted(''); return; }
    let cancelled = false;
    async function highlight() {
      try {
        const { codeToHtml } = await import('shiki');
        const html = await codeToHtml(code, {
          lang: language || 'text',
          theme: isDark ? 'github-dark-default' : 'github-light-default',
        });
        if (!cancelled) setHighlighted(html);
      } catch { if (!cancelled) setHighlighted(''); }
    }
    highlight();
    return () => { cancelled = true; };
  }, [code, language, isOpen, isDark]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closePanel]);

  // Resize drag
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta)));
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, setWidth]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleOpenInBrowser = useCallback(() => {
    const html = getPreviewHtml(code, language || '');
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, [code, language]);

  const lines = code.split('\n');

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40 lg:hidden" onClick={closePanel} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[600px] lg:relative lg:z-auto lg:max-w-none border-l border-[var(--border)] flex flex-col"
        style={{ backgroundColor: 'var(--code-bg)', animation: isResizing ? undefined : 'slide-in-right 0.2s ease-out' }}
      >
        {/* Resize handle */}
        <div onMouseDown={handleResizeStart} className="hidden lg:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 group">
          <div className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${isResizing ? 'bg-[var(--primary)]' : 'bg-transparent hover:bg-[var(--primary)]/50'}`} />
        </div>

        {/* Header */}
        <div className="border-b" style={{ backgroundColor: 'var(--code-header-bg)', borderColor: 'var(--code-border)' }}>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 20%, transparent)', color: 'var(--model-accent)' }}>
                {language || 'code'}
              </span>
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--code-fg)' }}>{title}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setWordWrap(!wordWrap)} className="p-1.5 rounded-md transition-colors cursor-pointer"
                style={{ color: wordWrap ? 'var(--code-fg)' : 'var(--code-line-nr)' }} title="Toggle word wrap">
                <WrapText className="w-4 h-4" />
              </button>
              {canPreview && (
                <button onClick={handleOpenInBrowser}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer hover:opacity-80"
                  style={{ color: 'var(--model-accent)' }} title="Open in browser tab">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </button>
              )}
              <button onClick={handleCopy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer hover:opacity-80"
                style={{ color: 'var(--code-line-nr)' }}>
                {copied ? <><Check className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
              </button>
              <button onClick={closePanel} className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-80"
                style={{ color: 'var(--code-line-nr)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex px-4 gap-1" style={{ borderColor: 'var(--code-border)' }}>
            <button onClick={() => setActiveTab('code')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors cursor-pointer border-b-2"
              style={{
                color: activeTab === 'code' ? 'var(--model-accent)' : 'var(--code-line-nr)',
                borderColor: activeTab === 'code' ? 'var(--model-accent)' : 'transparent',
                backgroundColor: activeTab === 'code' ? 'color-mix(in srgb, var(--model-accent) 8%, transparent)' : 'transparent',
              }}>
              <Code2 className="w-3.5 h-3.5" />Code
            </button>
            <button onClick={() => setActiveTab('preview')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors cursor-pointer border-b-2"
              style={{
                color: activeTab === 'preview' ? 'var(--model-accent)' : 'var(--code-line-nr)',
                borderColor: activeTab === 'preview' ? 'var(--model-accent)' : 'transparent',
                backgroundColor: activeTab === 'preview' ? 'color-mix(in srgb, var(--model-accent) 8%, transparent)' : 'transparent',
              }}>
              <Eye className="w-3.5 h-3.5" />Preview
            </button>
          </div>
        </div>

        {/* Content */}
        {activeTab === 'code' ? (
          <div className="flex-1 overflow-auto">
            <div className="flex min-h-full">
              <div className="flex-shrink-0 py-4 pl-4 pr-3 text-right select-none sticky left-0"
                style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-line-nr)' }}>
                {lines.map((_, i) => (
                  <div key={i} className="text-xs leading-6 font-mono">{i + 1}</div>
                ))}
              </div>
              {highlighted ? (
                <div className={`flex-1 py-4 px-4 text-sm leading-6 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent ${
                  wordWrap ? '[&_pre]:!whitespace-pre-wrap [&_code]:!whitespace-pre-wrap break-words' : 'overflow-x-auto'
                }`} dangerouslySetInnerHTML={{ __html: highlighted }} />
              ) : (
                <pre className={`flex-1 py-4 px-4 text-sm leading-6 ${wordWrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto'}`}
                  style={{ color: 'var(--code-fg)' }}><code>{code}</code></pre>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {(() => {
              const lang = language || '';
              const previewHtml = getPreviewHtml(code, lang);
              if (previewHtml) {
                return (
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full h-full min-h-[400px] border-0"
                    sandbox="allow-scripts allow-same-origin"
                    title={`${lang} preview`}
                  />
                );
              }
              return (
                <div className="flex-1 flex flex-col items-center justify-center h-full min-h-[300px] gap-3 px-8" style={{ color: 'var(--code-line-nr)' }}>
                  <Eye className="w-10 h-10 opacity-30" />
                  <p className="text-sm text-center font-medium">
                    Preview is not available for <span className="uppercase font-semibold" style={{ color: 'var(--model-accent)' }}>{language || 'this language'}</span>
                  </p>
                  <p className="text-xs text-center opacity-70">
                    Supported: HTML, React (TSX/JSX), CSS, Markdown, JSON, Mermaid
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}