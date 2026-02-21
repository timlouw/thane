import { defineComponent, signal } from 'thane';

/**
 * PlaygroundEditor — Lightweight embeddable code playground.
 *
 * Works by creating an iframe with a mini thane runtime (playground-runtime).
 * The user code is evaluated inside the iframe sandbox. Signals trigger a
 * full re-render, and @event bindings are wired up after each render.
 *
 * Supports: signal, computed, batch, effect, html, css, when, whenElse,
 * repeat, defineComponent, mount, @click, @input, and event modifiers.
 */

type PlaygroundEditorProps = {
  initialCode?: string;
  compact?: string;
};

// ── Playground Runtime (injected into iframe) ──
// This is a self-contained ~3KB JavaScript runtime that provides a working
// thane-like API inside the sandboxed iframe. It re-renders the entire
// component on signal change (not surgical, but perfect for demos).

const PLAYGROUND_RUNTIME = `(function(W){
var _sigs=[],_rerender=null,_evts={},_eid=0,_batch=0,_pend=false;
function sched(){if(_batch>0){_pend=true;return}if(_rerender)requestAnimationFrame(_rerender)}
W.signal=function(init){var v=init,subs=[];
function s(nv){if(!arguments.length)return v;if(v!==nv){v=nv;for(var i=0;i<subs.length;i++)if(subs[i])subs[i](v);sched()}return v}
s.subscribe=function(cb,skip){subs.push(cb);if(!skip)cb(v);return function(){var i=subs.indexOf(cb);if(i>=0)subs[i]=null}};_sigs.push(s);return s};
W.computed=function(fn){return function(){return fn()}};
W.batch=function(fn){_batch++;try{fn()}finally{_batch--;if(_batch===0&&_pend){_pend=false;sched()}}};
W.effect=function(fn){fn();return function(){}};
W.when=function(c){return c?'':'style="display:none"'};
W.whenElse=function(c,a,b){return c?a:b};
W.repeat=function(items,tpl,empty,track){var a=typeof items==='function'?items():items;if(!a||a.length===0)return empty||'';return a.map(function(item,i){return tpl(item,i)}).join('')};
W.html=function(strings){var vals=[].slice.call(arguments,1),r='';
for(var i=0;i<strings.length;i++){r+=strings[i];if(i<vals.length){var val=vals[i];
if(typeof val==='function'&&!val.subscribe){var m=r.match(/@([\\w.]+)=$/);
if(m){r=r.slice(0,-m[0].length);var ps=m[1].split('.'),id='__e'+(_eid++);_evts[id]={e:ps[0],h:val,m:ps.slice(1)};r+='data-pe="'+id+'"'}
else{r+=val!=null?val:''}}else{r+=val!=null?val:''}}}return r};
W.css=function(strings){var vals=[].slice.call(arguments,1),r='';for(var i=0;i<strings.length;i++){r+=strings[i]+(i<vals.length?vals[i]:'')}return r};
function wire(el){el.querySelectorAll('[data-pe]').forEach(function(n){var id=n.getAttribute('data-pe'),c=_evts[id];
if(c){n.addEventListener(c.e,function(e){if(c.m.indexOf('prevent')>=0)e.preventDefault();if(c.m.indexOf('stop')>=0)e.stopPropagation();c.h(e)});n.removeAttribute('data-pe')}})}
W.defineComponent=function(a,b){var setup=typeof a==='string'?b:a;return{__setup:setup}};
W.mount=function(comp,target){var ct=target||W.document.getElementById('app')||W.document.body,setup=comp.__setup;
function render(){_evts={};_eid=0;var r=setup({root:ct,props:{}});ct.innerHTML=r.template||'';wire(ct);
if(r.styles){var s=W.document.getElementById('__pgs');if(!s){s=W.document.createElement('style');s.id='__pgs';W.document.head.appendChild(s)}s.textContent=r.styles}
if(r.onMount)r.onMount()}_rerender=render;render();return{root:ct,destroy:function(){ct.innerHTML=''}}};
})(window);`;

const IFRAME_STYLES = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0f;color:#fafafa;padding:16px;line-height:1.6}
button{font-family:inherit;cursor:pointer}a{color:#818cf8}`;

const DEFAULT_CODE = `const Counter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);
  const reset = () => count(0);

  return {
    template: html\`
      <div class="counter">
        <div class="display">\${count()}</div>
        <p class="label">clicks</p>
        <div class="btns">
          <button @click=\${decrement}>−</button>
          <button class="reset" @click=\${reset}>Reset</button>
          <button class="primary" @click=\${increment}>+</button>
        </div>
      </div>
    \`,
    styles: css\`
      .counter {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      .display {
        font-size: 3.5rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .label {
        font-size: 13px;
        color: #71717a;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .btns {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      button {
        padding: 8px 20px;
        border: 1px solid #27272a;
        border-radius: 6px;
        background: #1c1c22;
        color: #fafafa;
        font-size: 16px;
        font-weight: 600;
        transition: all 150ms ease;
      }
      button:hover {
        background: #27272a;
        border-color: #3f3f46;
      }
      .primary {
        background: #6366f1;
        border-color: #6366f1;
      }
      .primary:hover {
        background: #818cf8;
        border-color: #818cf8;
      }
      .reset { font-size: 12px; }
    \`,
  };
});

mount(Counter);`;

function buildIframeHTML(code: string): string {
  const safe = code.replace(/<\/script/gi, '<\\/script');
  return (
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    IFRAME_STYLES +
    '</style>' +
    '<script>' +
    PLAYGROUND_RUNTIME +
    '<\/script>' +
    '</head><body><div id="app"></div>' +
    '<script>' +
    safe +
    '<\/script>' +
    '</body></html>'
  );
}

export const PlaygroundEditor = defineComponent<PlaygroundEditorProps>('playground-editor', ({ root, props }) => {
  const code = signal(props.initialCode || DEFAULT_CODE);
  const isCompact = props.compact === 'true';

  let debounceTimer: number | undefined;

  const runCode = () => {
    const iframe = root.querySelector('.pg-preview') as HTMLIFrameElement;
    if (!iframe) return;
    const htmlContent = buildIframeHTML(code());
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    // Revoke previous blob URL
    if (iframe.dataset.blobUrl) URL.revokeObjectURL(iframe.dataset.blobUrl);
    iframe.dataset.blobUrl = url;
    iframe.src = url;
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    code(target.value);
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(runCode, 600);
  };

  const handleTab = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      code(ta.value);
    }
  };

  return {
    template: html`
      <div class="playground">
        <div class="pg-editor">
          <div class="pg-header">
            <span class="pg-dot red"></span>
            <span class="pg-dot yellow"></span>
            <span class="pg-dot green"></span>
            <span class="pg-title">playground.ts</span>
            <button class="pg-run-btn" @click=${runCode}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run
            </button>
          </div>
          <textarea
            class="pg-textarea"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            @input=${handleInput}
            @keydown=${handleTab}
          ></textarea>
        </div>
        <div class="pg-output">
          <div class="pg-header pg-output-header">
            <span class="pg-title">Preview</span>
            <span class="pg-live-dot"></span>
          </div>
          <iframe class="pg-preview" sandbox="allow-scripts" title="Playground preview"></iframe>
        </div>
      </div>
    `,
    styles: css`
      .playground {
        display: grid;
        grid-template-columns: 1fr 1fr;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        overflow: hidden;
        background: var(--code-bg);
      }

      .pg-compact {
        max-height: 380px;
      }

      .pg-full {
        min-height: 500px;
      }

      .pg-editor {
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--border-color);
      }

      .pg-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
      }

      .pg-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }

      .red {
        background: #ff5f57;
      }
      .yellow {
        background: #febc2e;
      }
      .green {
        background: #28c840;
      }

      .pg-title {
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 12px;
        margin-left: 4px;
      }

      .pg-run-btn {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-xs);
        background: var(--accent-subtle);
        color: var(--accent);
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .pg-run-btn:hover {
        background: var(--accent);
        color: white;
      }

      .pg-textarea {
        flex: 1;
        width: 100%;
        padding: 16px 20px;
        border: none;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.7;
        tab-size: 2;
        white-space: pre;
        overflow: auto;
      }

      .pg-textarea::placeholder {
        color: var(--text-muted);
      }

      .pg-output {
        display: flex;
        flex-direction: column;
      }

      .pg-output-header {
        justify-content: space-between;
      }

      .pg-live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--success);
        animation: glow 2s ease-in-out infinite;
      }

      .pg-preview {
        flex: 1;
        width: 100%;
        border: none;
        background: #0a0a0f;
      }

      @media (max-width: 768px) {
        .playground {
          grid-template-columns: 1fr;
        }
        .pg-editor {
          border-right: none;
          border-bottom: 1px solid var(--border-color);
          max-height: 300px;
        }
        .pg-preview {
          min-height: 250px;
        }
      }
    `,
    onMount: () => {
      root.querySelector('.playground')?.classList.add(isCompact ? 'pg-compact' : 'pg-full');

      const textarea = root.querySelector('.pg-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = code();
      }
      // Auto-run on mount
      setTimeout(runCode, 100);
    },
  };
});
