/**
 * Studio workspace tree + file editor.
 * Prefers Monaco from a CDN; falls back to the textarea if the loader fails.
 */

import { state } from './studio-state.js';
import { showToast, formatUnifiedDiffHtml } from './ui.js';

export const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';

const LANGUAGE_BY_EXT = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  py: 'python',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby'
};

let workspaceTree = [];
let monacoEditor = null;
let monacoLoadPromise = null;
let editMode = false;

export function languageFromPath(filePath) {
  const ext = String(filePath || '').split('.').pop()?.toLowerCase();
  return LANGUAGE_BY_EXT[ext] || 'plaintext';
}

export function loadMonacoEditor() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (window.monaco) return Promise.resolve(window.monaco);
  if (monacoLoadPromise) return monacoLoadPromise;

  monacoLoadPromise = new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), 8000);
    const existing = document.querySelector('script[data-oas-monaco-loader]');
    const startAmd = () => {
      try {
        if (!window.require || typeof window.require.config !== 'function') {
          clearTimeout(timeout);
          resolve(null);
          return;
        }
        window.require.config({ paths: { vs: MONACO_CDN } });
        window.require(['vs/editor/editor.main'], () => {
          clearTimeout(timeout);
          resolve(window.monaco || null);
        });
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    };

    if (existing && window.require) {
      startAmd();
      return;
    }

    const script = document.createElement('script');
    script.src = MONACO_CDN + '/loader.js';
    script.async = true;
    script.dataset.oasMonacoLoader = '1';
    script.onload = startAmd;
    script.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return monacoLoadPromise;
}

function workspaceEls() {
  return {
    codeDisplay: document.getElementById('workspace-code-display'),
    editor: document.getElementById('workspace-file-editor'),
    host: document.getElementById('monaco-editor-host'),
    diffDisplay: document.getElementById('workspace-diff-viewer'),
    btnEdit: document.getElementById('btn-edit-workspace-file'),
    btnSave: document.getElementById('btn-save-workspace-file'),
    btnCancel: document.getElementById('btn-cancel-edit-workspace-file')
  };
}

export function hideWorkspaceEditors() {
  const { editor, host } = workspaceEls();
  if (editor) editor.style.display = 'none';
  if (host) host.style.display = 'none';
  editMode = false;
}

function setEditorValue(text, filePath) {
  const { editor } = workspaceEls();
  if (editor) editor.value = text || '';
  if (monacoEditor && window.monaco) {
    const model = monacoEditor.getModel();
    if (model) {
      window.monaco.editor.setModelLanguage(model, languageFromPath(filePath));
    }
    monacoEditor.setValue(text || '');
  }
}

function getEditorValue() {
  if (monacoEditor) return monacoEditor.getValue();
  const { editor } = workspaceEls();
  return editor ? editor.value : '';
}

function showReadOnlyView() {
  const { codeDisplay, editor, host, btnEdit, btnSave, btnCancel } = workspaceEls();
  if (editor) editor.style.display = 'none';
  if (host) host.style.display = 'none';
  if (codeDisplay) codeDisplay.style.display = 'block';
  if (btnEdit) btnEdit.style.display = 'inline-flex';
  if (btnSave) btnSave.style.display = 'none';
  if (btnCancel) btnCancel.style.display = 'none';
  editMode = false;
}

function renderLineNumbered(content) {
  const lines = String(content || '').split('\n');
  return lines.map((line, i) => {
    const num = String(i + 1).padStart(4, ' ');
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span style="color: #475569; user-select: none;">${num}  </span>${escaped}`;
  }).join('\n');
}

async function ensureMonacoInstance(value, filePath) {
  const monaco = await loadMonacoEditor();
  const { host } = workspaceEls();
  if (!monaco || !host) return null;
  if (!monacoEditor) {
    monacoEditor = monaco.editor.create(host, {
      value: value || '',
      language: languageFromPath(filePath),
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: "JetBrains Mono, Fira Code, Menlo, monospace",
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2
    });
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const saveBtn = document.getElementById('btn-save-workspace-file');
      if (saveBtn && saveBtn.style.display !== 'none') saveBtn.click();
    });
  } else {
    setEditorValue(value || '', filePath);
  }
  return monacoEditor;
}

async function enterEditMode() {
  if (!state.currentWorkspaceFilePath) {
    showToast('No File Selected', 'Please select a file from the workspace tree to edit', 'warning');
    return;
  }
  const content = state.currentWorkspaceFileContent || '';
  const { codeDisplay, editor, host, btnEdit, btnSave, btnCancel } = workspaceEls();
  setEditorValue(content, state.currentWorkspaceFilePath);
  if (codeDisplay) codeDisplay.style.display = 'none';
  if (btnEdit) btnEdit.style.display = 'none';
  if (btnSave) btnSave.style.display = 'inline-flex';
  if (btnCancel) btnCancel.style.display = 'inline-flex';
  editMode = true;

  const instance = await ensureMonacoInstance(content, state.currentWorkspaceFilePath);
  if (instance && host) {
    host.style.display = 'block';
    if (editor) editor.style.display = 'none';
    instance.focus();
    instance.layout();
  } else if (editor) {
    editor.style.display = 'block';
    editor.focus();
  }
}

function getFsFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs': return '[js]';
    case 'ts':
    case 'tsx': return '[ts]';
    case 'json': return '[json]';
    case 'md': return '[md]';
    case 'html': return '[html]';
    case 'css': return '[css]';
    case 'py': return '[py]';
    case 'sh': return '[sh]';
    case 'yml':
    case 'yaml': return '[yml]';
    case 'lock': return '[lock]';
    default: return '[file]';
  }
}

export async function loadWorkspaceTree() {
  const container = document.getElementById('fs-tree-container');
  if (!container) return;
  try {
    const res = await fetch('/api/fs/tree');
    if (res.ok) {
      const data = await res.json();
      workspaceTree = data.tree || [];
      renderFsTree(workspaceTree, container);
      if (!state.currentWorkspaceFilePath) {
        openWorkspaceFile('package.json');
      }
    }
  } catch {
    container.innerHTML = '<div style="color: var(--status-error); padding: 8px;">Failed to load filesystem tree</div>';
  }
}

function renderFsTree(items, parentEl, depth = 0) {
  if (depth === 0) parentEl.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `fs-tree-item fs-depth-${Math.min(depth, 4)}`;
    const isDir = item.type === 'directory';
    const icon = isDir ? '[dir]' : getFsFileIcon(item.name);

    row.innerHTML = `<span class="fs-icon">${icon}</span><span>${item.name}</span>`;
    parentEl.appendChild(row);

    if (isDir && item.children && item.children.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.style.display = depth < 1 ? 'block' : 'none';
      parentEl.appendChild(childContainer);
      renderFsTree(item.children, childContainer, depth + 1);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = childContainer.style.display !== 'none';
        childContainer.style.display = open ? 'none' : 'block';
        row.querySelector('.fs-icon').textContent = open ? '[dir]' : '[open]';
      });
    } else if (!isDir) {
      row.addEventListener('click', () => {
        document.querySelectorAll('.fs-tree-item').forEach(el => el.classList.remove('active'));
        row.classList.add('active');
        openWorkspaceFile(item.path);
      });
    }
  });
}

export async function openWorkspaceFile(filePath) {
  const { codeDisplay } = workspaceEls();
  const badge = document.getElementById('code-viewer-file-badge');
  const statsBadge = document.getElementById('code-viewer-stats');

  if (badge) badge.textContent = filePath;
  if (codeDisplay) codeDisplay.textContent = 'Loading ' + filePath + '...';

  state.currentWorkspaceFilePath = filePath;
  showReadOnlyView();
  loadMonacoEditor();

  try {
    const res = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
    if (res.ok) {
      const data = await res.json();
      state.currentWorkspaceFileContent = data.content || '';
      setEditorValue(state.currentWorkspaceFileContent, filePath);

      const lines = (data.content || '').split('\n');
      if (statsBadge) {
        const byteSize = new Blob([data.content || '']).size;
        const sizeStr = byteSize > 1024 ? `${(byteSize / 1024).toFixed(1)} KB` : `${byteSize} B`;
        statsBadge.textContent = `${lines.length} lines • ${sizeStr} • UTF-8`;
        statsBadge.style.display = 'inline-block';
      }

      if (codeDisplay) {
        codeDisplay.innerHTML = renderLineNumbered(data.content || '');
      }
    } else {
      const err = await res.json();
      if (codeDisplay) codeDisplay.textContent = 'Error: ' + (err.error || 'Failed to read file');
      if (statsBadge) statsBadge.style.display = 'none';
    }
  } catch (err) {
    if (codeDisplay) codeDisplay.textContent = 'Error loading file: ' + err.message;
    if (statsBadge) statsBadge.style.display = 'none';
  }
}

function initWorkspaceEditorController() {
  const { btnEdit, btnSave, btnCancel, editor, codeDisplay, diffDisplay } = workspaceEls();

  if (btnEdit) {
    btnEdit.onclick = () => {
      enterEditMode();
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => {
      setEditorValue(state.currentWorkspaceFileContent || '', state.currentWorkspaceFilePath);
      showReadOnlyView();
    };
  }

  const saveCurrentFile = async () => {
    if (!state.currentWorkspaceFilePath) return;
    const newContent = getEditorValue();
    const origContent = state.currentWorkspaceFileContent || '';

    try {
      const res = await fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.currentWorkspaceFilePath, content: newContent })
      });

      if (res.ok) {
        try {
          const diffRes = await fetch('/api/fs/diff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: state.currentWorkspaceFilePath,
              original: origContent,
              modified: newContent
            })
          });
          if (diffRes.ok) {
            const diffData = await diffRes.json();
            if (diffDisplay && diffData.diff) {
              diffDisplay.innerHTML = formatUnifiedDiffHtml(diffData.diff);
            }
          }
        } catch {
          // optional visual diff
        }

        state.currentWorkspaceFileContent = newContent;
        if (codeDisplay) {
          codeDisplay.innerHTML = renderLineNumbered(newContent);
        }
        showReadOnlyView();
        showToast('File Saved', `Successfully wrote to ${state.currentWorkspaceFilePath}`, 'success');
      } else {
        const err = await res.json();
        showToast('Save Error', err.error || 'Failed to save file', 'error');
      }
    } catch (err) {
      showToast('Save Error', err.message, 'error');
    }
  };

  if (btnSave) btnSave.onclick = saveCurrentFile;

  if (editor) {
    editor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!editMode) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    }
  });
}

export function initWorkspaceFilesystem() {
  const refreshBtn = document.getElementById('btn-refresh-fs');
  if (refreshBtn) refreshBtn.onclick = loadWorkspaceTree;

  const btnCreateFile = document.getElementById('btn-create-file');
  if (btnCreateFile) {
    btnCreateFile.onclick = async () => {
      const filename = prompt('Enter new file path relative to workspace (e.g. src/new-module.js):');
      if (!filename || !filename.trim()) return;
      const cleanPath = filename.trim().replace(/^\/+/, '');
      try {
        const res = await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cleanPath, content: `// ${cleanPath}\n` })
        });
        if (res.ok) {
          showToast('File Created', `Created ${cleanPath}`, 'success');
          await loadWorkspaceTree();
          openWorkspaceFile(cleanPath);
        } else {
          const err = await res.json();
          showToast('Create Failed', err.error || 'Failed to create file', 'error');
        }
      } catch (e) {
        showToast('Error', e.message, 'error');
      }
    };
  }

  const btnCreateFolder = document.getElementById('btn-create-folder');
  if (btnCreateFolder) {
    btnCreateFolder.onclick = async () => {
      const foldername = prompt('Enter new directory path relative to workspace (e.g. docs/guides):');
      if (!foldername || !foldername.trim()) return;
      const cleanPath = foldername.trim().replace(/^\/+/, '') + '/.gitkeep';
      try {
        const res = await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cleanPath, content: '' })
        });
        if (res.ok) {
          showToast('Directory Created', `Created directory: ${foldername.trim()}`, 'success');
          await loadWorkspaceTree();
        } else {
          const err = await res.json();
          showToast('Create Failed', err.error || 'Failed to create directory', 'error');
        }
      } catch (e) {
        showToast('Error', e.message, 'error');
      }
    };
  }

  const searchInput = document.getElementById('fs-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      const items = document.querySelectorAll('.fs-tree-item');
      items.forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(q) ? 'flex' : 'none';
      });
    });
  }

  const tabCode = document.getElementById('tab-code-viewer');
  const tabDiff = document.getElementById('tab-diff-viewer');
  const { codeDisplay, editor, host, diffDisplay } = workspaceEls();

  if (tabCode && tabDiff) {
    tabCode.onclick = () => {
      tabCode.classList.add('active');
      tabDiff.classList.remove('active');
      if (diffDisplay) diffDisplay.style.display = 'none';
      if (editMode) {
        if (monacoEditor && host) {
          host.style.display = 'block';
          if (editor) editor.style.display = 'none';
          monacoEditor.layout();
        } else if (editor) {
          editor.style.display = 'block';
        }
        if (codeDisplay) codeDisplay.style.display = 'none';
      } else if (codeDisplay) {
        hideWorkspaceEditors();
        codeDisplay.style.display = 'block';
      }
    };
    tabDiff.onclick = () => {
      tabDiff.classList.add('active');
      tabCode.classList.remove('active');
      if (codeDisplay) codeDisplay.style.display = 'none';
      hideWorkspaceEditors();
      if (diffDisplay) diffDisplay.style.display = 'block';
    };
  }

  initWorkspaceEditorController();
  loadWorkspaceTree();
}
