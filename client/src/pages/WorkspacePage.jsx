import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Activity, ArrowLeft, Braces, Check, ChevronRight, Code2, Download, ExternalLink, FileCode2, FilePlus2, FileSearch, Files, Folder, FolderPlus, GitBranch, GitCommitHorizontal, MessageSquareText, Pencil, Play, Plus, Save, Search, Send, Settings2, ShieldCheck, TerminalSquare, Upload, Users, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import api, { getMessage } from '../services/api.js';
import { createSocket } from '../services/socket.js';
import { ErrorState, LoadingState } from '../components/common/StateView.jsx';

const idOf = (value) => String(value?._id ?? value?.id ?? value ?? '');
const languageForPath = (path = '') => ({ js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', go: 'go', rs: 'rust', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', php: 'php', rb: 'ruby', cs: 'csharp', kt: 'kotlin', kts: 'kotlin', swift: 'swift', dart: 'dart', ex: 'elixir', exs: 'elixir', hs: 'haskell', lhs: 'haskell', lua: 'lua', pl: 'perl', r: 'r', scala: 'scala', sc: 'scala', clj: 'clojure', cljs: 'clojure', sh: 'shell', bash: 'shell', html: 'html', css: 'css', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql' }[path.split('.').pop()?.toLowerCase()] || 'plaintext');
const toBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
function socketAck(socket, event, payload) {
  return new Promise((resolve, reject) => socket.timeout(10_000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response)));
}
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'D';
const TERMINAL_SHELLS = [
  { id: 'language', name: 'Project runtime', prompt: '/workspace $ ' },
  { id: 'bash', name: 'Bash', prompt: '/workspace $ ' },
  { id: 'ubuntu', name: 'Ubuntu Bash', prompt: '/workspace $ ' },
  { id: 'git', name: 'Git shell', prompt: '/workspace $ ' },
  { id: 'powershell', name: 'PowerShell Core', prompt: 'PS /workspace> ' },
];

function buildExplorerTree(files, directories) {
  const root = { name: '', path: '', directories: new Map(), files: [] };
  const ensureDirectory = (path) => {
    let node = root;
    let currentPath = '';
    for (const name of path.split('/').filter(Boolean)) {
      currentPath = currentPath ? currentPath + '/' + name : name;
      if (!node.directories.has(name)) node.directories.set(name, { name, path: currentPath, directories: new Map(), files: [] });
      node = node.directories.get(name);
    }
    return node;
  };
  (directories || []).forEach((path) => ensureDirectory(path));
  (files || []).forEach((file) => {
    const parts = file.path.split('/');
    const name = parts.pop();
    ensureDirectory(parts.join('/')).files.push({ ...file, name });
  });
  return root;
}

function bindSharedText(doc, editor) {
  const model = editor.getModel();
  const text = doc.getText('monaco');
  if (!model) return { destroy() {} };
  if (model.getValue() !== text.toString()) model.setValue(text.toString());
  let applyingRemote = false;
  const onSharedUpdate = (event) => {
    if (model.getValue() === text.toString()) return;
    let oldOffset = 0;
    let pendingStart = null;
    let pendingDelete = 0;
    let pendingInsert = '';
    const edits = [];
    const flush = () => {
      if (pendingStart === null) return;
      const start = model.getPositionAt(pendingStart);
      const end = model.getPositionAt(pendingStart + pendingDelete);
      edits.push({ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: pendingInsert, forceMoveMarkers: true });
      pendingStart = null;
      pendingDelete = 0;
      pendingInsert = '';
    };
    for (const operation of event.delta) {
      if (operation.retain !== undefined) { flush(); oldOffset += operation.retain; }
      else if (operation.delete !== undefined) { if (pendingStart === null) pendingStart = oldOffset; pendingDelete += operation.delete; oldOffset += operation.delete; }
      else if (operation.insert !== undefined) { if (pendingStart === null) pendingStart = oldOffset; pendingInsert += typeof operation.insert === 'string' ? operation.insert : ''; }
    }
    flush();
    if (!edits.length) { model.setValue(text.toString()); return; }
    applyingRemote = true;
    try { model.applyEdits(edits); } finally { applyingRemote = false; }
  };
  const editorSubscription = model.onDidChangeContent((event) => {
    if (applyingRemote || !event.changes.length) return;
    const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
    doc.transact(() => {
      for (const change of changes) {
        if (change.rangeLength) text.delete(change.rangeOffset, change.rangeLength);
        if (change.text) text.insert(change.rangeOffset, change.text);
      }
    }, editor);
  });
  text.observe(onSharedUpdate);
  return { destroy() { text.unobserve(onSharedUpdate); editorSubscription.dispose(); } };
}

function TerminalPanel({ open, panel, onPanelChange, onClose, configured, online, runnerMessage, canWrite, theme, terminals, activeTerminalId, onSelectTerminal, onCreateTerminal, onCloseTerminal, onShellChange, onTranscript, onHistoryChange, onCwdChange, onExecute, outputLines, problems, onProblemClick, workspaceId, ports, onForwardPort, onRemovePort }) {
  const host = useRef(null);
  const terminal = useRef(null);
  const activeTerminal = terminals.find((item) => item.id === activeTerminalId) || null;
  const execute = useRef(onExecute);
  const transcriptCallback = useRef(onTranscript);
  const historyCallback = useRef(onHistoryChange);
  const cwdCallback = useRef(onCwdChange);
  const workingDirectory = useRef(activeTerminal?.cwd || '');
  const [portDraft, setPortDraft] = useState('3000');
  const [portBusy, setPortBusy] = useState(false);
  execute.current = onExecute;
  transcriptCallback.current = onTranscript;
  historyCallback.current = onHistoryChange;
  cwdCallback.current = onCwdChange;
  workingDirectory.current = activeTerminal?.cwd || '';

  useEffect(() => {
    if (!open || panel !== 'terminal' || !activeTerminal || !host.current) return undefined;
    const shell = TERMINAL_SHELLS.find((item) => item.id === activeTerminal.shell) || TERMINAL_SHELLS[0];
    workingDirectory.current = activeTerminal.cwd || '';
    const promptFor = (cwd) => shell.id === 'powershell'
      ? `PS /workspace${cwd ? '/' + cwd : ''}> `
      : `/workspace${cwd ? '/' + cwd : ''} $ `;
    const instance = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace',
      fontSize: 12,
      theme: theme === 'dark'
        ? { background: '#10141b', foreground: '#e5e7eb', cursor: '#a5abff', selectionBackground: '#59627b' }
        : { background: '#fff', foreground: '#20242c', cursor: '#5969d9', selectionBackground: '#c8d0fa' },
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(host.current);
    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(host.current);
    requestAnimationFrame(() => fit.fit());
    instance.writeln('DEVCOLLAB · ' + shell.name);
    instance.writeln('Working directory: ' + (workingDirectory.current ? '/workspace/' + workingDirectory.current : '/workspace'));
    for (const entry of activeTerminal.transcript || []) {
      if (entry.kind === 'command') instance.write(promptFor(entry.cwd || '') + entry.text + '\r\n');
      else instance.writeln(entry.text);
    }
    if (!configured) instance.writeln('No isolated runner is configured; commands cannot execute yet.');
    else if (!online) instance.writeln(runnerMessage || 'The configured isolated runner is currently unavailable.');
    else instance.writeln('Commands run in an isolated container.');

    let subscription = null;
    let disposed = false;
    if (canWrite) {
      let input = '';
      let history = [...(activeTerminal.history || [])];
      let historyIndex = history.length;
      instance.write('\r\n' + promptFor(workingDirectory.current));
      subscription = instance.onData((data) => {
        if (data === '\r') {
          instance.write('\r\n');
          const command = input.trim();
          input = '';
          if (!command) { instance.write(promptFor(workingDirectory.current)); return; }
          const commandCwd = workingDirectory.current;
          history.push(command);
          if (history.length > 100) history = history.slice(-100);
          historyIndex = history.length;
          historyCallback.current(activeTerminal.id, history);
          transcriptCallback.current(activeTerminal.id, { kind: 'command', text: command, cwd: commandCwd });
          execute.current(activeTerminal.id, activeTerminal.shell, command, commandCwd).then((result) => {
            if (typeof result?.cwd === 'string') {
              cwdCallback.current(activeTerminal.id, result.cwd);
              if (!disposed) workingDirectory.current = result.cwd;
              if (result.cwd !== commandCwd) transcriptCallback.current(activeTerminal.id, { kind: 'meta', text: 'Working directory: ' + (result.cwd ? '/workspace/' + result.cwd : '/workspace') });
            }
            const clean = (value) => String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
            for (const [kind, value] of [['stdout', result?.stdout], ['stderr', result?.stderr]]) {
              if (!value) continue;
              const output = clean(value);
              transcriptCallback.current(activeTerminal.id, { kind, text: output });
              if (!disposed) instance.writeln(output);
            }
            if (result?.exitCode !== undefined) {
              const exitMessage = 'Process exited with code ' + result.exitCode + '.';
              transcriptCallback.current(activeTerminal.id, { kind: 'meta', text: exitMessage });
              if (!disposed) instance.writeln(exitMessage);
            }
          }).catch((error) => {
            const errorMessage = 'Runner error: ' + getMessage(error);
            transcriptCallback.current(activeTerminal.id, { kind: 'error', text: errorMessage });
            if (!disposed) instance.writeln(errorMessage);
          }).finally(() => {
            if (!disposed) {
              instance.write('\r\n' + promptFor(workingDirectory.current));
              instance.scrollToBottom();
            }
          });
        } else if (data === '\u001b[A' || data === '\u001b[B') {
          if (data === '\u001b[A') historyIndex = Math.max(0, historyIndex - 1);
          else historyIndex = Math.min(history.length, historyIndex + 1);
          input = history[historyIndex] || '';
          instance.write('\r\x1b[K' + promptFor(workingDirectory.current) + input);
        } else if (data === '\u007f' || data === '\b') {
          if (input.length) { input = input.slice(0, -1); instance.write('\b \b'); }
        } else if (data.length === 1 && data >= ' ' && data <= '~') {
          input += data;
          instance.write(data);
        }
      });
    } else instance.writeln('This workspace is read-only. Terminal input is disabled.');
    terminal.current = { instance, fit, subscription };
    return () => {
      disposed = true;
      resizeObserver.disconnect();
      terminal.current?.subscription?.dispose();
      terminal.current?.instance.dispose();
      terminal.current = null;
    };
  }, [open, panel, activeTerminal?.id, activeTerminal?.shell, configured, online, runnerMessage, canWrite, theme]);

  useEffect(() => {
    if (open && panel === 'terminal') requestAnimationFrame(() => terminal.current?.fit.fit());
  }, [open, panel, activeTerminalId]);

  return <section className={'ide-terminal ' + (open ? 'ide-terminal-open' : '')} aria-hidden={!open}>
    <div className="ide-terminal-heading">
      <div className="ide-bottom-tabs" role="tablist" aria-label="Workspace output panels">
        <button type="button" role="tab" aria-selected={panel === 'problems'} className={panel === 'problems' ? 'active' : ''} onClick={() => onPanelChange('problems')}>PROBLEMS <span className="ide-problem-count">{problems.length}</span></button>
        <button type="button" role="tab" aria-selected={panel === 'output'} className={panel === 'output' ? 'active' : ''} onClick={() => onPanelChange('output')}>OUTPUT</button>
        <button type="button" role="tab" aria-selected={panel === 'terminal'} className={panel === 'terminal' ? 'active' : ''} onClick={() => onPanelChange('terminal')}>TERMINAL</button>
        <button type="button" role="tab" aria-selected={panel === 'ports'} className={panel === 'ports' ? 'active' : ''} onClick={() => onPanelChange('ports')}>PORTS {ports.length > 0 && <span className="ide-problem-count">{ports.length}</span>}</button>
      </div>
      <div className="ide-bottom-actions"><span className={configured && online ? 'ide-runner-ready' : 'ide-runner-offline'}>{configured ? (online ? 'Runner connected' : 'Runner unavailable') : 'Runner not configured'}</span><button type="button" onClick={onClose} title="Close panel" aria-label="Close bottom panel"><X size={13} /></button></div>
    </div>
    <div className="ide-terminal-content">
      <div className={'ide-terminal-session-workspace ' + (panel === 'terminal' ? 'is-active' : '')} aria-hidden={panel !== 'terminal'}>
        <div className="ide-terminal-session-bar">
          <div className="ide-terminal-session-tabs" role="tablist" aria-label="Terminal sessions">
            {terminals.map((item) => <div className={'ide-terminal-session-tab ' + (item.id === activeTerminalId ? 'active' : '')} key={item.id}>
              <button type="button" role="tab" aria-selected={item.id === activeTerminalId} onClick={() => onSelectTerminal(item.id)} title={item.name}>{item.name}</button>
              <button type="button" className="ide-terminal-session-close" onClick={() => onCloseTerminal(item.id)} aria-label={'Close ' + item.name} title={'Close ' + item.name}><X size={11} /></button>
            </div>)}
            <button type="button" className="ide-terminal-new" onClick={onCreateTerminal} title="Create terminal" aria-label="Create terminal"><Plus size={13} /></button>
          </div>
          {activeTerminal && <select aria-label="Terminal type" value={activeTerminal.shell} disabled={!canWrite} onChange={(event) => onShellChange(activeTerminal.id, event.target.value)}>
            {TERMINAL_SHELLS.map((shell) => <option key={shell.id} value={shell.id}>{shell.name}</option>)}
            <option value="cmd" disabled>Windows CMD (requires Windows containers)</option>
          </select>}
        </div>
        {activeTerminal
          ? <div className="ide-terminal-output is-active" ref={host} />
          : <div className="ide-terminal-empty">No terminals open. Select + to create one.</div>}
      </div>
      <div className={'ide-output-view ' + (panel === 'output' ? 'is-active' : '')} aria-hidden={panel !== 'output'}>
        {outputLines.length ? outputLines.map((entry) => <div className={'ide-output-entry ide-output-' + entry.level} key={entry.id}><time>{entry.time}</time><pre>{entry.message}</pre></div>) : <p className="ide-panel-empty">No output yet. Run a command from the terminal when a runner is connected.</p>}
      </div>
      <div className={'ide-problems-view ' + (panel === 'problems' ? 'is-active' : '')} aria-hidden={panel !== 'problems'}>
        {problems.length ? <div className="ide-problems-list">{problems.map((problem) => <button type="button" className={'ide-problem-row ide-problem-' + problem.severity.toLowerCase()} key={problem.id} onClick={() => onProblemClick(problem)}><span className="ide-problem-severity">{problem.severity}</span><span className="ide-problem-message">{problem.message}</span><small>{problem.filePath} ({problem.line}:{problem.column})</small></button>)}</div> : <p className="ide-panel-empty">No problems detected in open files.</p>}
      </div>
      <div className={'ide-ports-view ' + (panel === 'ports' ? 'is-active' : '')} aria-hidden={panel !== 'ports'}>
        <form className="ide-forward-port-form" onSubmit={async (event) => { event.preventDefault(); const port = Number(portDraft); if (!Number.isInteger(port) || port < 1024 || port > 65535) return; setPortBusy(true); try { await onForwardPort(port, activeTerminal?.shell || 'language'); } catch { /* workspace notice shows the failure */ } finally { setPortBusy(false); } }}>
          <label htmlFor="workspace-forward-port">Port</label><input id="workspace-forward-port" type="number" min="1024" max="65535" value={portDraft} onChange={(event) => setPortDraft(event.target.value)} disabled={!canWrite || !configured || !online} />
          <button type="submit" className="button button-small" disabled={portBusy || !canWrite || !configured || !online}><Plus size={13} />{portBusy ? 'Forwarding…' : 'Forward Port'}</button>
        </form>
        <p className="ide-ports-help">Run your app on <code>0.0.0.0</code>. Background example: {activeTerminal?.shell === 'powershell' ? <code>Start-Process npm -ArgumentList 'run','dev','--','--host','0.0.0.0' -RedirectStandardOutput '/tmp/devcollab-app.log' -RedirectStandardError '/tmp/devcollab-app.err'</code> : <code>npm run dev -- --host 0.0.0.0 &gt;/tmp/devcollab-app.log 2&gt;&amp;1 &amp;</code>}</p>
        {ports.length ? <div className="ide-forwarded-ports">{ports.map((entry) => <div className="ide-forwarded-port" key={entry.port}><span className="ide-port-status" /><strong>{entry.port}</strong><small>{entry.terminalType || entry.profile || 'runtime'} · forwarded</small><a href={api.getUri({ url: `/workspaces/${workspaceId}/ports/${entry.port}/proxy/` })} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a><button type="button" onClick={() => onRemovePort(entry.port)} aria-label={`Stop forwarding port ${entry.port}`}><X size={13} /></button></div>)}</div> : <p className="ide-panel-empty">No ports forwarded. Add the port your app listens on.</p>}
      </div>
    </div>
  </section>;
}

export default function WorkspacePage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const { theme } = useTheme();
  const [project, setProject] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [files, setFiles] = useState([]);
  const [directories, setDirectories] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const [movingItem, setMovingItem] = useState('');
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const [savingFile, setSavingFile] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadScope, setDownloadScope] = useState('project');
  const [downloadTargetPath, setDownloadTargetPath] = useState('');
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [runtime, setRuntime] = useState({ configured: false, profiles: [] });
  const [permissions, setPermissions] = useState({ canWrite: false, role: '' });
  const [busy, setBusy] = useState(true);
  const [fatalError, setFatalError] = useState('');
  const [socketReady, setSocketReady] = useState(false);
  const [activePath, setActivePath] = useState('');
  const [activeDoc, setActiveDoc] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [sidebar, setSidebar] = useState('files');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState('chat');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalSessions, setTerminalSessions] = useState([{ id: 'terminal-1', name: 'Terminal 1', shell: 'language', cwd: '', history: [], transcript: [] }]);
  const [activeTerminalId, setActiveTerminalId] = useState('terminal-1');
  const terminalSequence = useRef(2);
  const [bottomPanel, setBottomPanel] = useState('terminal');
  const [outputLines, setOutputLines] = useState([]);
  const [problems, setProblems] = useState([]);
  const [syncStatus, setSyncStatus] = useState('Connecting');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [showTaskComposer, setShowTaskComposer] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [gitResult, setGitResult] = useState('');
  const [gitMessage, setGitMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [forwardedPorts, setForwardedPorts] = useState([]);
  const [online, setOnline] = useState({});
  const [remoteCursors, setRemoteCursors] = useState({});
  const [settings, setSettings] = useState({ fontSize: 14, tabSize: 2, wordWrap: 'on', runtimeProfile: 'node' });
  const socketRef = useRef(null);
  const workspaceRef = useRef(null);
  const activePathRef = useRef('');
  const docsRef = useRef(new Map());
  const bindingRef = useRef(null);
  const editorRef = useRef(null);
  const markerSubscriptionRef = useRef(null);
  const uploadInputRef = useRef(null);

  useEffect(() => () => markerSubscriptionRef.current?.dispose(), []);
  const canWrite = permissions.canWrite;
  const canManageTeam = ['Owner', 'Team Leader'].includes(permissions.role) || user?.role === 'admin';
  const addOutput = useCallback((message, level = 'info') => {
    const entry = { id: String(Date.now()) + '-' + Math.random(), time: new Date().toLocaleTimeString(), message: String(message).slice(0, 20000), level };
    setOutputLines((current) => [...current, entry].slice(-250));
  }, []);
  const explorerTree = useMemo(() => buildExplorerTree(files, directories), [files, directories]);
  const downloadFolderPaths = useMemo(() => {
    const paths = new Set(directories);
    for (const file of files) {
      const parts = file.path.split('/');
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current ? current + '/' + part : part;
        paths.add(current);
      }
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
  }, [files, directories]);

  function handleExplorerDragStart(event, path, kind) {
    if (!canWrite) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-devcollab-workspace-item', JSON.stringify({ path, kind }));
    event.dataTransfer.setData('text/plain', path);
    setDropTargetPath(null);
  }

  function handleExplorerDragOver(event, targetPath) {
    if (!canWrite || movingItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath(targetPath);
  }

  function handleExplorerDrop(event, targetDirectory) {
    event.preventDefault();
    event.stopPropagation();
    setDropTargetPath(null);
    if (!canWrite || movingItem) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-devcollab-workspace-item'));
      if (!payload?.path || !['file', 'directory'].includes(payload.kind)) return;
      void moveWorkspaceItem(payload.path, targetDirectory);
    } catch {
      setNotice('Could not read the dragged workspace item. Try dragging it again.');
    }
  }

  function renderExplorerNodes(node, depth = 0) {
    const folders = [...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name));
    const entries = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    return <>
      {folders.map((folder) => {
        const collapsed = Boolean(collapsedFolders[folder.path]);
        return <div className="ide-tree-folder-wrap" key={'folder:' + folder.path}>
          <button type="button" className={'ide-tree-folder ' + (selectedFolderPath === folder.path ? 'selected ' : '') + (dropTargetPath === folder.path ? 'drop-target' : '')} style={{ paddingLeft: 6 + depth * 14 }} aria-expanded={!collapsed} draggable={canWrite} onClick={() => { setSelectedFolderPath(folder.path); setCollapsedFolders((current) => ({ ...current, [folder.path]: !current[folder.path] })); }} onDragStart={(event) => handleExplorerDragStart(event, folder.path, 'directory')} onDragEnd={() => setDropTargetPath(null)} onDragOver={(event) => handleExplorerDragOver(event, folder.path)} onDragLeave={() => setDropTargetPath((current) => current === folder.path ? null : current)} onDrop={(event) => handleExplorerDrop(event, folder.path)}>
            <ChevronRight size={12} className={'ide-tree-chevron ' + (!collapsed ? 'expanded' : '')} /><Folder size={14} /><span>{folder.name}</span>
          </button>
          {canWrite && <button type="button" className="ide-tree-folder-rename" title={'Rename ' + folder.path} aria-label={'Rename ' + folder.path} onClick={(event) => { event.stopPropagation(); renameWorkspaceItem(folder.path); }}><Pencil size={12} /></button>}
          {canWrite && <button type="button" className="ide-tree-folder-add" title={'New subfolder inside ' + folder.path} aria-label={'New subfolder inside ' + folder.path} onClick={(event) => { event.stopPropagation(); createFolder(folder.path); }}><FolderPlus size={13} /></button>}
          {!collapsed && renderExplorerNodes(folder, depth + 1)}
        </div>;
      })}
      {entries.map((file) => <div key={file.path} draggable={canWrite} onDragStart={(event) => handleExplorerDragStart(event, file.path, 'file')} onDragEnd={() => setDropTargetPath(null)} className={'ide-file-row ide-tree-file-row ' + (activePath === file.path ? 'selected' : '')} style={{ paddingLeft: 6 + depth * 14 }}>
        <button type="button" onClick={() => openFile(file.path)} title={file.path}><FileCode2 size={14} /><span>{file.name}</span></button>
        {canWrite && <button className="ide-file-rename" onClick={() => renameWorkspaceItem(file.path)} title={'Rename ' + file.path} aria-label={'Rename ' + file.path}><Pencil size={12} /></button>}
        {canWrite && <button className="ide-file-delete" onClick={() => deleteFile(file.path)} title={'Delete ' + file.path} aria-label={'Delete ' + file.path}><X size={12} /></button>}
      </div>)}
    </>;
  }

  function toggleTerminalPanel() {
    if (!terminalOpen) {
      setTerminalOpen(true);
      setBottomPanel('terminal');
    } else if (bottomPanel !== 'terminal') setBottomPanel('terminal');
    else setTerminalOpen(false);
  }

  function createTerminalSession() {
    const number = terminalSequence.current++;
    const session = { id: 'terminal-' + number, name: 'Terminal ' + number, shell: 'language', cwd: '', history: [], transcript: [] };
    setTerminalSessions((current) => [...current, session]);
    setActiveTerminalId(session.id);
    setTerminalOpen(true);
    setBottomPanel('terminal');
  }

  function closeTerminalSession(terminalId) {
    const remaining = terminalSessions.filter((session) => session.id !== terminalId);
    setTerminalSessions(remaining);
    if (activeTerminalId === terminalId) setActiveTerminalId(remaining.at(-1)?.id || '');
  }

  const changeTerminalShell = useCallback((terminalId, shell) => {
    setTerminalSessions((current) => current.map((session) => session.id === terminalId ? { ...session, shell } : session));
  }, []);

  const appendTerminalTranscript = useCallback((terminalId, entry) => {
    setTerminalSessions((current) => current.map((session) => session.id === terminalId
      ? { ...session, transcript: [...session.transcript, { ...entry, text: String(entry.text).slice(0, 20_000) }].slice(-160) }
      : session));
  }, []);

  const saveTerminalHistory = useCallback((terminalId, history) => {
    setTerminalSessions((current) => current.map((session) => session.id === terminalId ? { ...session, history: history.slice(-100) } : session));
  }, []);

  const saveTerminalCwd = useCallback((terminalId, cwd) => {
    setTerminalSessions((current) => current.map((session) => session.id === terminalId ? { ...session, cwd } : session));
  }, []);
  const refreshFiles = useCallback(async (workspaceId) => {
    const { data } = await api.get(`/workspaces/${workspaceId}/files`);
    setFiles(data.data);
    return data.data;
  }, []);

  const openFile = useCallback(async (path) => {
    const currentWorkspace = workspaceRef.current;
    if (!path || !currentWorkspace) return;
    const existing = docsRef.current.get(path);
    if (existing) {
      try {
        if (socketRef.current?.connected && !existing.joined) {
          const joined = await socketAck(socketRef.current, 'workspace:file:join', { workspaceId: currentWorkspace._id, path });
          if (!joined?.success) throw new Error(joined?.message || 'Could not sync this file.');
          if (joined.data?.state) Y.applyUpdate(existing.doc, fromBase64(joined.data.state), 'remote');
          existing.joined = true;
        }
        activePathRef.current = path;
        setActivePath(path);
        setActiveDoc(existing.doc);
        setTabs((current) => current.includes(path) ? current : [...current, path]);
        return;
      } catch (error) {
        setNotice(getMessage(error));
        return;
      }
    }
    setSyncStatus('Opening file…');
    setNotice('');
    try {
      const response = await api.get(`/workspaces/${currentWorkspace._id}/file`, { params: { path } });
      const file = response.data.data;
      const doc = new Y.Doc();
      if (socketRef.current?.connected) {
        const joined = await socketAck(socketRef.current, 'workspace:file:join', { workspaceId: currentWorkspace._id, path });
        if (!joined?.success) throw new Error(joined?.message || 'Could not sync this file.');
        if (joined.data?.state) Y.applyUpdate(doc, fromBase64(joined.data.state), 'server');
      } else if (file.content) doc.getText('monaco').insert(0, file.content);
      const entry = { doc, file, binding: null, saveTimer: null, joined: Boolean(socketRef.current?.connected), pendingSync: Promise.resolve(true) };
      doc.on('update', (update, origin) => {
        if (origin === 'remote' || origin === 'server') return;
        setSyncStatus('Saving…');
        if (socketRef.current?.connected) {
          const encodedUpdate = toBase64(update);
          entry.pendingSync = entry.pendingSync.then(async () => {
            if (!socketRef.current?.connected) throw new Error('Workspace connection was lost before the change synced.');
            const ack = await socketAck(socketRef.current, 'workspace:file:update', { workspaceId: currentWorkspace._id, path, update: encodedUpdate });
            if (!ack?.success) throw new Error(ack?.message || 'A change could not be synced.');
            setSyncStatus('Syncing…');
            return true;
          }).catch((error) => {
            setNotice(getMessage(error));
            setSyncStatus('Sync failed');
            return false;
          });
        } else {
          window.clearTimeout(entry.saveTimer);
          entry.saveTimer = window.setTimeout(async () => {
            try {
              const { data } = await api.put(`/workspaces/${currentWorkspace._id}/files`, { path, content: doc.getText('monaco').toString(), version: entry.file.version });
              entry.file.version = data.data.version;
              setSyncStatus('Saved offline');
            } catch (error) { setNotice(getMessage(error)); setSyncStatus('Save failed'); }
          }, 450);
        }
      });
      docsRef.current.set(path, entry);
      activePathRef.current = path;
      setActivePath(path);
      setActiveDoc(doc);
      setTabs((current) => current.includes(path) ? current : [...current, path]);
      setSyncStatus('Connected');
    } catch (error) {
      setNotice(getMessage(error));
      setSyncStatus('Offline');
    }
  }, []);

  const executeCommand = useCallback(async (terminalId, terminalType, command, cwd = '') => {
    if (!workspace) throw new Error('Workspace is still loading.');
    const terminalName = terminalSessions.find((session) => session.id === terminalId)?.name || 'Terminal';
    addOutput('[' + terminalName + '] ' + (cwd ? '/workspace/' + cwd : '/workspace') + ' $ ' + command, 'command');
    try {
      const response = await api.post('/workspaces/' + workspace._id + '/terminal', { command, terminalType, cwd }, { timeout: 180_000 });
      const result = response.data.data || {};
      if (Array.isArray(result.directories)) setDirectories(result.directories);
      if (result.changedPaths?.length || result.deletedPaths?.length) await refreshFiles(workspace._id);
      if (result.stdout) addOutput(result.stdout, 'stdout');
      if (result.stderr) addOutput(result.stderr, 'stderr');
      if (result.exitCode !== undefined) addOutput('Process exited with code ' + result.exitCode + '.', 'meta');
      return result;
    } catch (error) {
      addOutput(getMessage(error), 'error');
      throw error;
    }
  }, [workspace, terminalSessions, addOutput, refreshFiles]);

  async function runGitAction(action) {
    try {
      const { data } = await api.post(`/workspaces/${workspace._id}/git`, { action, message: gitMessage });
      const result = data.data || {};
      setGitResult(typeof result.stdout === 'string' ? result.stdout : JSON.stringify(result, null, 2));
      if (action === 'commit') setGitMessage('');
      setNotice(`Git ${action} completed.`);
    } catch (error) { setNotice(getMessage(error)); }
  }

  async function forwardPort(port, terminalType = 'language') {
    try {
      const { data } = await api.post(`/workspaces/${workspace._id}/ports`, { port, terminalType }, { timeout: 150_000 });
      setForwardedPorts(data.data.forwardedPorts || []);
      setNotice(`Port ${port} is forwarded. Start a server on 0.0.0.0:${port}.`);
    } catch (error) { setNotice(getMessage(error)); throw error; }
  }

  async function removeForwardedPort(port) {
    try {
      const { data } = await api.delete(`/workspaces/${workspace._id}/ports`, { data: { port } });
      setForwardedPorts(data.data.forwardedPorts || []);
      if (previewUrl.includes(`/ports/${port}/`)) setPreviewUrl('');
    } catch (error) { setNotice(getMessage(error)); }
  }
  async function startPreview() {
    try {
      const { data } = await api.post(`/workspaces/${workspace._id}/preview`);
      const url = new URL(data.data.previewUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Runner returned an invalid preview URL.');
      setPreviewUrl(url.toString());
      setForwardedPorts(data.data.forwardedPorts || []);
      setNotice('Workspace preview is ready.');
    } catch (error) { setNotice(getMessage(error)); }
  }

  useEffect(() => {
    let active = true;
    let socket;
    async function loadWorkspace() {
      setBusy(true);
      setFatalError('');
      try {
        const [workspaceResponse, messageResponse, taskResponse] = await Promise.all([
          api.get(`/workspaces/project/${projectId}`),
          api.get(`/messages/project/${projectId}`, { params: { limit: 100 } }),
          api.get(`/tasks/project/${projectId}`, { params: { limit: 100 } }),
        ]);
        if (!active) return;
        const payload = workspaceResponse.data.data;
        setProject(payload.project);
        workspaceRef.current = payload.workspace;
        setWorkspace(payload.workspace);
        setForwardedPorts(payload.workspace.settings?.forwardedPorts || []);
        setFiles(payload.files);
        setDirectories(payload.workspace.directories || []);
        setActivity(payload.activity || []);
        setRuntime(payload.runtime || { configured: false, profiles: [] });
        setPermissions(payload.permissions || { canWrite: false });
        setSettings({
          fontSize: payload.workspace.settings?.editor?.fontSize || 14,
          tabSize: payload.workspace.settings?.editor?.tabSize || 2,
          wordWrap: payload.workspace.settings?.editor?.wordWrap || 'on',
          runtimeProfile: payload.workspace.runtimeProfile || 'node',
        });
        setChatMessages(messageResponse.data.data || []);
        setTasks(taskResponse.data.data || []);
        socket = createSocket();
        socketRef.current = socket;
        let initialJoinComplete = false;
        const joinSocketRooms = async () => {
          const joined = await socketAck(socket, 'workspace:join', { projectId });
          if (!joined?.success) throw new Error(joined?.message || 'Workspace access denied.');
          await socketAck(socket, 'chat:project:join', { projectId });
          for (const [path, entry] of docsRef.current) {
            const fileJoin = await socketAck(socket, 'workspace:file:join', { workspaceId: payload.workspace._id, path });
            if (!fileJoin?.success) continue;
            entry.joined = true;
            if (fileJoin.data?.state) Y.applyUpdate(entry.doc, fromBase64(fileJoin.data.state), 'remote');
            if (fileJoin.data?.vector) {
              const missing = Y.encodeStateAsUpdate(entry.doc, fromBase64(fileJoin.data.vector));
              if (missing.length > 2) {
                const synced = await socketAck(socket, 'workspace:file:update', { workspaceId: payload.workspace._id, path, update: toBase64(missing) });
                if (!synced?.success) throw new Error(synced?.message || 'Could not sync an offline file change.');
              }
            }
          }
        };
        socket.on('workspace:file:update', ({ workspaceId, path, update }) => {
          if (String(workspaceId) !== String(payload.workspace._id)) return;
          const entry = docsRef.current.get(path);
          if (entry) Y.applyUpdate(entry.doc, fromBase64(update), 'remote');
          setSyncStatus('Syncing…');
        });
        socket.on('workspace:file:persisted', ({ path }) => {
          if (docsRef.current.has(path)) setSyncStatus('All changes saved');
        });
        socket.on('workspace:file:limit', ({ path, message }) => {
          if (path && docsRef.current.has(path)) { setSyncStatus('Save failed'); setNotice(message || 'File changes could not be saved.'); }
        });
        socket.on('workspace:file:cursor', ({ userId, username, path, position }) => {
          if (!path || userId === idOf(user)) return;
          setRemoteCursors((current) => ({ ...current, [path]: { ...(current[path] || {}), [userId]: { username, position } } }));
        });
        socket.on('workspace:file:created', () => refreshFiles(payload.workspace._id).catch(() => {}));
        socket.on('workspace:directory:created', ({ directories: nextDirectories }) => setDirectories(nextDirectories || []));
        socket.on('workspace:files:moved', ({ directories: nextDirectories }) => {
          if (nextDirectories) setDirectories(nextDirectories);
          refreshFiles(payload.workspace._id).catch(() => {});
        });
        socket.on('workspace:terminal:files:changed', ({ changedPaths = [], deletedPaths = [], directories: nextDirectories }) => {
          const changed = new Set([...changedPaths, ...deletedPaths]);
          const deleted = new Set(deletedPaths);
          const oldActivePath = activePathRef.current;
          for (const path of changed) {
            const entry = docsRef.current.get(path);
            if (!entry) continue;
            if (entry.joined && socket.connected) socket.emit('workspace:file:leave', { workspaceId: payload.workspace._id, path });
            window.clearTimeout(entry.saveTimer);
            entry.cursorSubscription?.dispose();
            entry.binding?.destroy();
            entry.doc.destroy();
            docsRef.current.delete(path);
          }
          if (nextDirectories) setDirectories(nextDirectories);
          if (deleted.size) setTabs((current) => current.filter((path) => !deleted.has(path)));
          refreshFiles(payload.workspace._id).catch(() => {});
          if (changed.has(oldActivePath)) {
            bindingRef.current?.destroy();
            bindingRef.current = null;
            editorRef.current = null;
            activePathRef.current = '';
            setActivePath('');
            setActiveDoc(null);
            if (!deleted.has(oldActivePath)) window.setTimeout(() => { void openFile(oldActivePath); }, 0);
          }
          setNotice('Terminal updated workspace files.');
        });
        socket.on('workspace:file:deleted', ({ path }) => {
          setFiles((current) => current.filter((file) => file.path !== path));
          const entry = docsRef.current.get(path);
          if (entry) { entry.cursorSubscription?.dispose(); entry.binding?.destroy(); entry.doc.destroy(); docsRef.current.delete(path); }
          setTabs((current) => current.filter((openPath) => openPath !== path));
          if (activePathRef.current === path) { activePathRef.current = ''; setActivePath(''); setActiveDoc(null); }
        });
        socket.on('workspace:presence', (presence) => setOnline((current) => ({ ...current, [presence.userId]: presence.online ? presence : null })));
        socket.on('workspace:presence', (presence) => {
          if (presence.online) return;
          setRemoteCursors((current) => Object.fromEntries(Object.entries(current).map(([path, cursors]) => [path, Object.fromEntries(Object.entries(cursors).filter(([id]) => id !== presence.userId))])));
        });
        socket.on('chat:project:message', (message) => {
          if (idOf(message.project) !== String(projectId)) return;
          setChatMessages((current) => current.some((entry) => idOf(entry) === idOf(message)) ? current : [...current, message]);
        });
        socket.on('connect', () => {
          setSocketReady(true);
          if (initialJoinComplete) joinSocketRooms().catch((error) => { setSocketReady(false); setNotice(getMessage(error, 'Could not rejoin live collaboration.')); });
        });
        socket.on('disconnect', () => {
          for (const entry of docsRef.current.values()) entry.joined = false;
          setSocketReady(false);
          setSyncStatus('Reconnecting');
          setRemoteCursors({});
        });
        socket.on('connect_error', (error) => { setSyncStatus('Offline'); setNotice(getMessage(error, 'Live collaboration is unavailable.')); });
        socket.connect();
        try {
          await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error('Live collaboration could not connect.')), 10_000);
            socket.once('connect', () => { window.clearTimeout(timeout); resolve(); });
            socket.once('connect_error', (error) => { window.clearTimeout(timeout); reject(error); });
          });
          await joinSocketRooms();
          initialJoinComplete = true;
        } catch (error) {
          setSocketReady(false);
          setSyncStatus('Offline editing');
          setNotice(`${getMessage(error, 'Live collaboration is unavailable.')} File editing will save to the database when possible.`);
        }
        if (payload.files?.[0]) await openFile(payload.files[0].path);
        if (active) setBusy(false);
      } catch (error) {
        if (active) { setFatalError(getMessage(error)); setBusy(false); }
      }
    }
    loadWorkspace();
    return () => {
      active = false;
      socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      bindingRef.current?.destroy();
      bindingRef.current = null;
      docsRef.current.forEach((entry) => { entry.cursorSubscription?.dispose(); entry.binding?.destroy(); entry.doc.destroy(); });
      docsRef.current.clear();
    };
  }, [projectId]);

  function editorMounted(editor, monaco) {
    bindingRef.current?.destroy();
    const entry = docsRef.current.get(activePath);
    const model = editor.getModel();
    if (!entry || !model) return;
    const binding = bindSharedText(entry.doc, editor);
    entry.binding = binding;
    bindingRef.current = binding;
    editorRef.current = editor;
    markerSubscriptionRef.current?.dispose();
    const updateProblems = () => {
      const nextProblems = monaco.editor.getModels().flatMap((model) => {
        const filePath = files.find((file) => model.uri.path.endsWith(file.path))?.path;
        if (!filePath) return [];
        return monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
          id: filePath + ':' + marker.startLineNumber + ':' + marker.startColumn + ':' + marker.message,
          filePath,
          line: marker.startLineNumber,
          column: marker.startColumn,
          severity: marker.severity === monaco.MarkerSeverity.Error ? 'Error' : marker.severity === monaco.MarkerSeverity.Warning ? 'Warning' : 'Info',
          message: marker.message,
        }));
      });
      setProblems(nextProblems);
    };
    markerSubscriptionRef.current = monaco.editor.onDidChangeMarkers(updateProblems);
    updateProblems();
    let lastCursorSentAt = 0;
    entry.cursorSubscription = editor.onDidChangeCursorPosition(({ position }) => {
      if (Date.now() - lastCursorSentAt < 75) return;
      lastCursorSentAt = Date.now();
      socketRef.current?.emit('workspace:file:cursor', { workspaceId: workspaceRef.current?._id, path: activePath, position: { lineNumber: position.lineNumber, column: position.column } });
    });
    editor.focus();
  }

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activePath) return;
    const entry = docsRef.current.get(activePath);
    if (!entry) return;
    const decorations = Object.values(remoteCursors[activePath] || {}).filter((cursor) => cursor.position.lineNumber <= model.getLineCount()).map((cursor) => ({
      range: { startLineNumber: cursor.position.lineNumber, startColumn: cursor.position.column, endLineNumber: cursor.position.lineNumber, endColumn: cursor.position.column },
      options: { beforeContentClassName: 'ide-remote-cursor-marker', hoverMessage: { value: `@${cursor.username || 'teammate'}` } },
    }));
    entry.cursorDecorationIds = editor.deltaDecorations(entry.cursorDecorationIds || [], decorations);
  }, [activeDoc, activePath, remoteCursors]);

  function closeTab(path) {
    const index = tabs.indexOf(path);
    if (index < 0) return;
    const remaining = tabs.filter((tab) => tab !== path);
    setTabs(remaining);
    const entry = docsRef.current.get(path);
    if (entry) {
      if (entry.joined && socketRef.current?.connected && workspaceRef.current) {
        socketRef.current.emit('workspace:file:leave', { workspaceId: workspaceRef.current._id, path });
      }
      entry.joined = false;
      entry.binding = null;
      entry.cursorSubscription?.dispose();
      entry.cursorSubscription = null;
    }
    if (activePathRef.current !== path) return;
    bindingRef.current?.destroy();
    bindingRef.current = null;
    editorRef.current = null;
    const nextPath = remaining[Math.max(0, index - 1)];
    if (nextPath) {
      void openFile(nextPath);
    } else {
      activePathRef.current = '';
      setActivePath('');
      setActiveDoc(null);
    }
  }
  async function saveActiveFile() {
    if (!canWrite || !activePath || savingFile) return false;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setNotice('Connect to the workspace to save the active file.');
      return false;
    }
    setSavingFile(true);
    try {
      const entry = docsRef.current.get(activePath);
      if (!entry) throw new Error('Open a file before saving it.');
      while (true) {
        const pending = entry.pendingSync;
        if (await pending === false) throw new Error('The latest file changes have not synced. Check your connection and try again.');
        if (pending === entry.pendingSync) break;
      }
      const result = await socketAck(socket, 'workspace:file:save', { workspaceId: workspace._id, path: activePath });
      if (!result?.success) throw new Error(result?.message || 'The file could not be saved.');
      setSyncStatus('All changes saved');
      setNotice('Saved ' + activePath + '.');
      return true;
    } catch (error) {
      setSyncStatus('Save failed');
      setNotice(getMessage(error));
      return false;
    } finally {
      setSavingFile(false);
    }
  }

  function chooseDownloadScope(scope) {
    setDownloadScope(scope);
    if (scope === 'folder') {
      setDownloadTargetPath((current) => downloadFolderPaths.includes(current) ? current : downloadFolderPaths[0] || '');
    } else if (scope === 'file') {
      setDownloadTargetPath((current) => files.some((file) => file.path === current) ? current : (files.some((file) => file.path === activePath) ? activePath : files[0]?.path || ''));
    }
  }

  async function downloadSelectionAsZip() {
    if (!workspace || downloadingZip) return;
    const params = { scope: downloadScope };
    if (downloadScope !== 'project') params.path = downloadTargetPath;
    const activeFileIncluded = activePath && (downloadScope === 'project'
      || (downloadScope === 'folder' && activePath.startsWith(downloadTargetPath + '/'))
      || (downloadScope === 'file' && activePath === downloadTargetPath));
    setDownloadingZip(true);
    try {
      if (canWrite && activeFileIncluded && socketRef.current?.connected) {
        const saved = await saveActiveFile();
        if (!saved) throw new Error('Could not save the active file before creating the ZIP.');
      }
      const response = await api.get('/workspaces/' + workspace._id + '/download.zip', { params, responseType: 'blob' });
      const disposition = response.headers['content-disposition'] || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      let fileName = encodedName ? decodeURIComponent(encodedName) : '';
      if (!fileName) {
        const name = downloadScope === 'project' ? project?.title : downloadTargetPath.split('/').pop();
        fileName = (name || 'devcollab') + '.zip';
      }
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDownloadDialogOpen(false);
      setNotice('Downloaded ' + fileName + ' to your device.');
    } catch (error) {
      let message = getMessage(error);
      const responseData = error.response?.data;
      if (typeof Blob !== 'undefined' && responseData instanceof Blob) {
        try {
          const payload = JSON.parse(await responseData.text());
          message = payload.message || message;
        } catch { /* Keep the standard request error message. */ }
      }
      setNotice(message);
    } finally {
      setDownloadingZip(false);
    }
  }

  async function uploadFiles(event) {
    const input = event.currentTarget;
    const selectedFiles = Array.from(input.files || []);
    if (!selectedFiles.length || !workspace) return;
    const parentPath = selectedFolderPath;
    setUploadingFiles(true);
    const uploaded = [];
    const errors = [];
    try {
      for (const file of selectedFiles) {
        if (file.size > 1_048_576) {
          errors.push(file.name + ' exceeds the 1 MB file limit.');
          continue;
        }
        try {
          const relativePath = file.webkitRelativePath || file.name;
          const path = parentPath ? parentPath + '/' + relativePath : relativePath;
          const content = await file.text();
          const response = await api.post('/workspaces/' + workspace._id + '/files', { path, content });
          uploaded.push(response.data.data.path);
        } catch (error) {
          errors.push(file.name + ': ' + getMessage(error));
        }
      }
      if (uploaded.length) {
        await refreshFiles(workspace._id);
        setNotice('Uploaded ' + uploaded.length + (uploaded.length === 1 ? ' file.' : ' files.') + (errors.length ? ' ' + errors[0] : ''));
      } else if (errors.length) {
        setNotice(errors[0]);
      }
    } catch (error) {
      setNotice(getMessage(error));
    } finally {
      input.value = '';
      setUploadingFiles(false);
    }
  }

  useEffect(() => {
    const handleSaveShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveActiveFile();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [activePath, canWrite, savingFile]);

  async function createFile(parentPath = selectedFolderPath) {
    const promptLabel = parentPath ? 'File name inside ' + parentPath + ':' : 'File path, such as src/app.js:';
    const requestedPath = window.prompt(promptLabel);
    if (!requestedPath?.trim()) return;
    const path = parentPath ? parentPath + '/' + requestedPath.trim() : requestedPath.trim();
    try {
      const response = await api.post('/workspaces/' + workspace._id + '/files', { path, content: '' });
      await refreshFiles(workspace._id);
      await openFile(response.data.data.path);
      setSidebar('files');
    } catch (error) { setNotice(getMessage(error)); }
  }

  async function createFolder(parentPath = selectedFolderPath) {
    const promptLabel = parentPath ? 'New folder name inside ' + parentPath + ':' : 'Folder path, such as src/components:';
    const requestedName = window.prompt(promptLabel);
    if (!requestedName?.trim()) return;
    const path = parentPath ? parentPath + '/' + requestedName.trim() : requestedName.trim();
    try {
      const { data } = await api.post('/workspaces/' + workspace._id + '/directories', { path });
      const created = data.data.created || [];
      setDirectories(data.data.directories || []);
      setCollapsedFolders((current) => {
        const next = { ...current };
        for (const folderPath of data.data.directories || []) next[folderPath] = false;
        return next;
      });
      setNotice(created.length ? 'Folder created.' : 'That folder already exists.');
    } catch (error) { setNotice(getMessage(error)); }
  }
  async function moveWorkspaceItem(sourcePath, targetDirectory, newName = '') {
    if (!canWrite || !workspace || movingItem) return;
    const isFile = files.some((file) => file.path === sourcePath);
    const sourceIsDirectory = !isFile && (directories.includes(sourcePath) || files.some((file) => file.path.startsWith(sourcePath + '/')));
    const sourceName = sourcePath.split('/').pop();
    const destinationName = newName || sourceName;
    const destinationRoot = targetDirectory ? targetDirectory + '/' + destinationName : destinationName;
    if (sourcePath === targetDirectory || (sourceIsDirectory && targetDirectory.startsWith(sourcePath + '/'))) {
      setNotice('A folder cannot be moved inside itself.');
      return;
    }
    if (destinationRoot === sourcePath) {
      setNotice('This item is already in that folder.');
      return;
    }
    const affectedPaths = files.map((file) => file.path).filter((path) => isFile ? path === sourcePath : path.startsWith(sourcePath + '/'));
    const openAffectedPaths = tabs.filter((path) => affectedPaths.includes(path));
    const oldActivePath = activePathRef.current;
    const currentSocket = socketRef.current;
    setMovingItem(sourcePath);
    try {
      if (openAffectedPaths.length && !currentSocket?.connected) {
        throw new Error('Reconnect to the workspace before moving a file that is open in the editor.');
      }
      for (const path of openAffectedPaths) {
        const entry = docsRef.current.get(path);
        if (entry?.joined) {
          const left = await socketAck(currentSocket, 'workspace:file:leave', { workspaceId: workspace._id, path });
          if (!left?.success) throw new Error(left?.message || 'Could not save an open file before moving it.');
          entry.joined = false;
        }
      }
      const response = await api.patch('/workspaces/' + workspace._id + '/move', { source: sourcePath, targetDirectory, ...(newName ? { newName } : {}) });
      const result = response.data.data;
      const fileMappings = (result.mappings || []).filter((mapping) => mapping.kind === 'file');
      const newPathByOldPath = new Map(fileMappings.map(({ from, to }) => [from, to]));
      for (const path of affectedPaths) {
        const entry = docsRef.current.get(path);
        if (!entry) continue;
        window.clearTimeout(entry.saveTimer);
        entry.cursorSubscription?.dispose();
        entry.binding?.destroy();
        entry.doc.destroy();
        docsRef.current.delete(path);
      }
      const movedOpenTabs = new Set(openAffectedPaths);
      setTabs((current) => current.filter((path) => !movedOpenTabs.has(path)));
      let nextActivePath = '';
      if (affectedPaths.includes(oldActivePath)) {
        nextActivePath = newPathByOldPath.get(oldActivePath) || '';
        bindingRef.current?.destroy();
        bindingRef.current = null;
        editorRef.current = null;
        activePathRef.current = '';
        setActivePath('');
        setActiveDoc(null);
      }
      setDirectories(result.directories || []);
      await refreshFiles(workspace._id);
      if (sourceIsDirectory && (selectedFolderPath === sourcePath || selectedFolderPath.startsWith(sourcePath + '/'))) {
        setSelectedFolderPath(destinationRoot + selectedFolderPath.slice(sourcePath.length));
      }
      setNotice(newName ? 'Renamed ' + sourcePath + ' to ' + destinationRoot + '.' : 'Moved ' + sourcePath + ' into ' + (targetDirectory || 'the project root') + '.');
      if (nextActivePath) await openFile(nextActivePath);
    } catch (error) {
      for (const path of openAffectedPaths) {
        const entry = docsRef.current.get(path);
        if (!entry || !currentSocket?.connected || entry.joined) continue;
        try {
          const joined = await socketAck(currentSocket, 'workspace:file:join', { workspaceId: workspace._id, path });
          if (joined?.success) {
            if (joined.data?.state) Y.applyUpdate(entry.doc, fromBase64(joined.data.state), 'remote');
            entry.joined = true;
          }
        } catch { /* Keep the current editor open if reconnection is still unavailable. */ }
      }
      setNotice(getMessage(error));
    } finally {
      setMovingItem('');
    }
  }

  async function renameWorkspaceItem(path) {
    const currentName = path.split('/').pop();
    const requestedName = window.prompt('Enter a new name for ' + path + ':', currentName);
    const newName = requestedName?.trim();
    if (!newName || newName === currentName) return;
    const parentPath = path.split('/').slice(0, -1).join('/');
    await moveWorkspaceItem(path, parentPath, newName);
  }

  async function deleteFile(path) {
    if (!window.confirm(`Delete ${path}? This removes it for everyone in the workspace.`)) return;
    try {
      await api.delete(`/workspaces/${workspace._id}/files`, { data: { path } });
      setFiles((current) => current.filter((file) => file.path !== path));
      const entry = docsRef.current.get(path);
      if (entry) { window.clearTimeout(entry.saveTimer); entry.cursorSubscription?.dispose(); entry.binding?.destroy(); entry.doc.destroy(); docsRef.current.delete(path); }
      setTabs((current) => current.filter((tab) => tab !== path));
      if (activePathRef.current === path) { activePathRef.current = ''; setActivePath(''); setActiveDoc(null); }
    } catch (error) { setNotice(getMessage(error)); }
  }

  async function searchFiles(event) {
    event.preventDefault();
    if (!searchQuery.trim()) return setSearchResults([]);
    try {
      const { data } = await api.get(`/workspaces/${workspace._id}/search`, { params: { q: searchQuery } });
      setSearchResults(data.data);
    } catch (error) { setNotice(getMessage(error)); }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const body = chatDraft.trim();
    if (!body || !socketRef.current?.connected) return;
    setChatDraft('');
    socketRef.current.emit('chat:project:send', { projectId, workspaceId: workspace._id, fileReference: activePath, body }, (ack) => {
      if (!ack?.success) { setNotice(ack?.message || 'Message could not be sent.'); setChatDraft(body); }
    });
  }

  async function updateSettings(changes) {
    const next = { ...settings, ...changes };
    setSettings(next);
    try {
      const { data } = await api.patch(`/workspaces/${workspace._id}/settings`, next);
      setSettings((current) => ({ ...current, ...data.data.settings.editor, runtimeProfile: data.data.runtimeProfile }));
    } catch (error) { setNotice(getMessage(error)); }
  }

  async function setMemberWorkspaceRole(member, role) {
    try {
      await api.put(`/projects/${projectId}/members/${idOf(member.user)}`, { action: 'setWorkspaceRole', role });
      setProject((current) => ({ ...current, members: current.members.map((entry) => idOf(entry.user) === idOf(member.user) ? { ...entry, workspaceRole: role } : entry) }));
    } catch (error) { setNotice(getMessage(error)); }
  }

  async function createTask(event) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    try {
      const { data } = await api.post('/tasks', { title, project: projectId, linkedFilePath: activePath || '' });
      setTasks((current) => [...current, data.data]);
      setTaskTitle('');
      setShowTaskComposer(false);
      setNotice('Task created for this project.');
    } catch (error) { setNotice(getMessage(error)); }
  }

  const memberRows = useMemo(() => project?.members || [], [project]);
  const activeFile = files.find((file) => file.path === activePath);
  if (busy) return <main className="ide-loading"><LoadingState label="Opening project workspace…" /></main>;
  if (fatalError) return <main className="ide-loading"><ErrorState message={fatalError} onRetry={() => window.location.reload()} /></main>;

  return <main className="ide-shell">
    <header className="ide-topbar">
      <div className="ide-topbar-left"><Link className="ide-back" to={`/app/projects/${projectId}`} aria-label="Back to project"><ArrowLeft size={16} /></Link><span className="ide-brand"><span><Code2 size={15} /></span>DEVCOLLAB</span><ChevronRight size={14} className="ide-top-chevron" /><strong>{project?.title}</strong><span className="ide-top-workspace">Workspace</span></div>
      <div className="ide-topbar-right"><span className={`ide-live-dot ${socketReady ? 'is-live' : ''}`} />{Object.values(online).filter(Boolean).length + (online[idOf(user)] ? 0 : 1)} online <span className="ide-top-divider" /><span className="ide-save-state">{syncStatus}</span><button type="button" className="ide-top-button" onClick={saveActiveFile} disabled={!canWrite || !activePath || !socketReady || savingFile || Boolean(movingItem)} title="Save active file (Ctrl+S)"><Save size={14} /> {savingFile ? 'Saving…' : 'Save'}</button><button type="button" className="ide-top-button" onClick={() => { setDownloadScope('project'); setDownloadTargetPath(activePath || downloadFolderPaths[0] || files[0]?.path || ''); setDownloadDialogOpen(true); }} title="Choose project, folder, or file to download as ZIP"><Download size={14} /> Download</button>{previewUrl && <a className="ide-top-button" href={previewUrl} target="_blank" rel="noreferrer">Open preview</a>}<button type="button" className="ide-top-button" onClick={startPreview} disabled={!runtime.configured || runtime.online === false || runtime.capabilities?.preview === false || !canWrite}><Play size={13} /> Preview</button><button type="button" className="ide-top-button" onClick={toggleTerminalPanel}><TerminalSquare size={14} /> Terminal</button><a className="ide-top-button ide-return-link" href={`/app/projects/${projectId}`}><ArrowLeft size={14} /> Project</a></div>
    </header>
    <section className="ide-workbench">
      <nav className="ide-activitybar" aria-label="Workspace tools">
        <button className={sidebar === 'files' ? 'active' : ''} onClick={() => { setSidebar('files'); setMobileSidebarOpen(true); }} title="Explorer"><Files size={19} /></button>
        <button className={sidebar === 'search' ? 'active' : ''} onClick={() => { setSidebar('search'); setMobileSidebarOpen(true); }} title="Search"><FileSearch size={19} /></button>
        <button className={sidebar === 'source' ? 'active' : ''} onClick={() => { setSidebar('source'); setMobileSidebarOpen(true); }} title="Source control"><GitBranch size={19} /></button>
        <button className={sidebar === 'runtime' ? 'active' : ''} onClick={() => { setSidebar('runtime'); setMobileSidebarOpen(true); }} title="Runtime environments"><Braces size={19} /></button>
        <button className="ide-panel-shortcut" onClick={() => { setRightPanel('chat'); setMobilePanelOpen(true); }} title="Project chat"><MessageSquareText size={17} /></button>
        <button className="ide-panel-shortcut" onClick={() => { setRightPanel('tasks'); setMobilePanelOpen(true); }} title="Project tasks"><Check size={17} /></button>
        <button className="ide-panel-shortcut" onClick={() => { setRightPanel('team'); setMobilePanelOpen(true); }} title="Project team"><Users size={17} /></button>
        <button className="ide-activity-spacer" onClick={() => { setSidebar('activity'); setMobileSidebarOpen(true); }} title="Recent activity"><Activity size={18} /></button>
        <button onClick={() => { setSidebar('settings'); setMobileSidebarOpen(true); }} title="Workspace settings"><Settings2 size={18} /></button>
      </nav>

      <aside className={`ide-explorer ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="ide-side-heading"><span>{sidebar === 'files' ? 'EXPLORER' : sidebar === 'search' ? 'SEARCH' : sidebar === 'source' ? 'SOURCE CONTROL' : sidebar === 'runtime' ? 'ENVIRONMENTS' : sidebar === 'settings' ? 'SETTINGS' : 'ACTIVITY'}</span>{sidebar === 'files' && canWrite && <div className="ide-explorer-actions"><button type="button" onClick={() => createFile(selectedFolderPath)} title={selectedFolderPath ? 'New file inside ' + selectedFolderPath : 'New file'} aria-label="New file"><FilePlus2 size={15} /></button><button type="button" onClick={() => createFolder(selectedFolderPath)} title={selectedFolderPath ? 'New folder inside ' + selectedFolderPath : 'New folder'} aria-label="New folder"><FolderPlus size={15} /></button><button type="button" onClick={() => uploadInputRef.current?.click()} title={selectedFolderPath ? 'Upload into ' + selectedFolderPath : 'Upload files'} aria-label="Upload files" disabled={uploadingFiles}><Upload size={15} /></button><input ref={uploadInputRef} type="file" multiple hidden onChange={uploadFiles} /></div>}</div>
        {sidebar === 'files' && <div className="ide-file-list"><div className={'ide-folder-root ' + (selectedFolderPath === '' ? 'selected ' : '') + (dropTargetPath === '' ? 'drop-target' : '')} onClick={() => setSelectedFolderPath('')} onDragOver={(event) => handleExplorerDragOver(event, '')} onDragLeave={() => setDropTargetPath((current) => current === '' ? null : current)} onDrop={(event) => handleExplorerDrop(event, '')}><Folder size={14} /> {project?.title || 'Project'}</div>{renderExplorerNodes(explorerTree)}{files.length === 0 && directories.length === 0 && <div className="ide-empty-side">No files or folders yet. Create one to start.</div>}</div>}{sidebar === 'search' && <div className="ide-search-panel"><form onSubmit={searchFiles}><Search size={14} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search workspace" /><button aria-label="Search"><ChevronRight size={14} /></button></form>{searchResults.map((result) => <button className="ide-search-result" key={result.path} onClick={() => openFile(result.path)}><FileCode2 size={13} />{result.path}</button>)}</div>}
        {sidebar === 'source' && <div className="ide-info-panel"><GitBranch size={20} /><strong>Source control</strong><p>Git operations run inside the isolated workspace runner. The local runner currently exposes terminal execution only.</p>{project?.githubRepo && <a href={project.githubRepo.startsWith('http') ? project.githubRepo : `https://github.com/${project.githubRepo}`} target="_blank" rel="noreferrer">Open linked GitHub repository</a>}<div className="ide-git-actions"><button className="button button-quiet" disabled={!runtime.configured || runtime.online === false || runtime.capabilities?.git === false} onClick={() => runGitAction('status')}><GitBranch size={13} /> Status</button><button className="button button-quiet" disabled={!runtime.configured || runtime.online === false || runtime.capabilities?.git === false} onClick={() => runGitAction('diff')}>View diff</button></div><form className="ide-git-commit" onSubmit={(event) => { event.preventDefault(); runGitAction('commit'); }}><input value={gitMessage} onChange={(event) => setGitMessage(event.target.value)} placeholder="Commit message" maxLength={240} disabled={!canWrite || !runtime.configured || runtime.online === false || runtime.capabilities?.git === false} /><button className="button" disabled={!gitMessage.trim() || !runtime.configured || runtime.online === false || runtime.capabilities?.git === false}><GitCommitHorizontal size={13} /> Commit</button></form>{gitResult && <pre className="ide-git-result">{gitResult}</pre>}<small>{runtime.configured && runtime.online !== false ? 'Runner connected. Link Git credentials in the runner to push or pull.' : 'Connect an isolated runner to enable Git.'}</small></div>}
        {sidebar === 'runtime' && <div className="ide-info-panel"><Braces size={20} /><strong>Language environments</strong><p>Choose a language profile for the isolated runner. Install libraries in the workspace using that environment’s package manager.</p>{runtime.profiles.map((profile) => <div className={`ide-runtime-option ${settings.runtimeProfile === profile.id ? 'selected' : ''}`} key={profile.id}><span><strong>{profile.name}</strong><small>{profile.extensions.map((extension) => `.${extension}`).join(', ')}</small></span><button disabled={!canWrite} onClick={() => updateSettings({ runtimeProfile: profile.id })}>{settings.runtimeProfile === profile.id ? <Check size={14} /> : 'Use'}</button></div>)}<div className="ide-runner-note"><ShieldCheck size={15} /><span>{runtime.configured ? 'Execution is delegated to the connected isolated runner.' : 'Execution is disabled until WORKSPACE_RUNNER_URL and WORKSPACE_RUNNER_TOKEN are configured.'}</span></div></div>}
        {sidebar === 'activity' && <div className="ide-activity-list">{activity.length ? activity.map((item) => <div className="ide-activity-item" key={item._id}><span><Activity size={13} /></span><strong>{item.summary || item.type}</strong><small>{item.userId?.username || 'A teammate'} · {new Date(item.createdAt).toLocaleString()}</small></div>) : <div className="ide-empty-side">File and workspace activity will appear here.</div>}</div>}
        {sidebar === 'settings' && <div className="ide-settings-panel"><label>Editor font size <input type="number" min="10" max="30" value={settings.fontSize} onChange={(event) => setSettings((current) => ({ ...current, fontSize: event.target.value === '' ? '' : Number(event.target.value) }))} onBlur={() => updateSettings({ fontSize: Math.min(30, Math.max(10, Number(settings.fontSize) || 14)) })} disabled={!canWrite} /></label><label>Tab size <select value={settings.tabSize} onChange={(event) => updateSettings({ tabSize: Number(event.target.value) })} disabled={!canWrite}>{[2, 4, 8].map((size) => <option key={size}>{size}</option>)}</select></label><label>Word wrap <select value={settings.wordWrap} onChange={(event) => updateSettings({ wordWrap: event.target.value })} disabled={!canWrite}><option value="on">On</option><option value="off">Off</option><option value="bounded">Bounded</option></select></label><div className="ide-runner-note"><ShieldCheck size={15} /><span>Files are stored in the project database. Code runs only through a separate runner.</span></div></div>}
      </aside>

      <section className="ide-editor-column">
        <div className="ide-tabs">{tabs.map((path) => <div className={'ide-editor-tab ' + (path === activePath ? 'active' : '')} key={path}><button type="button" className="ide-tab-select" onClick={() => openFile(path)} title={path}><FileCode2 size={13} /><span>{path.split('/').at(-1)}</span></button><button type="button" className="ide-tab-close" onClick={() => closeTab(path)} aria-label={'Close ' + path.split('/').at(-1)} title={'Close ' + path.split('/').at(-1)}><X size={12} /></button></div>)}<span className="ide-tabs-path">{activePath || 'Select a file to begin'}</span></div>
        {activeDoc ? <Editor key={activePath} path={activePath} defaultLanguage={languageForPath(activePath)} defaultValue="" theme={theme === 'dark' ? 'vs-dark' : 'vs'} onMount={editorMounted} options={{ automaticLayout: true, readOnly: !canWrite || Boolean(movingItem) || savingFile, minimap: { enabled: true }, fontSize: settings.fontSize, tabSize: settings.tabSize, wordWrap: settings.wordWrap, scrollBeyondLastLine: false, padding: { top: 14 }, renderWhitespace: 'selection', smoothScrolling: true, cursorBlinking: 'smooth' }} /> : <div className="ide-welcome"><div><span><Code2 size={22} /></span><h1>{project?.title}</h1><p>{activeFile ? 'Loading file…' : 'Choose a file from the explorer or create one to start building.'}</p><div className="ide-shortcut-grid"><span><kbd>Ctrl</kbd> <kbd>P</kbd><small>Quick open file</small></span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>F</kbd><small>Search workspace</small></span></div><button className="button" onClick={createFile} disabled={!canWrite}><FilePlus2 size={14} /> New file</button></div></div>}
        <div className="ide-statusbar"><span><GitBranch size={12} /> {workspace?.activeBranch || 'workspace'}</span><span>{activePath ? languageForPath(activePath) : 'Ready'}</span><span>{canWrite ? 'Editor access' : 'Read-only access'}</span><span>{socketReady ? 'Live collaboration' : 'Offline'}</span></div>
      </section>

      <aside className={`ide-right-panel ${mobilePanelOpen ? 'mobile-open' : ''}`}>
        <div className="ide-panel-tabs"><button className={rightPanel === 'chat' ? 'active' : ''} onClick={() => setRightPanel('chat')}><MessageSquareText size={13} /> Chat</button><button className={rightPanel === 'tasks' ? 'active' : ''} onClick={() => setRightPanel('tasks')}><Check size={13} /> Tasks</button><button className={rightPanel === 'team' ? 'active' : ''} onClick={() => setRightPanel('team')}><Users size={13} /> Team</button><button className="ide-mobile-panel-close" onClick={() => setMobilePanelOpen(false)} aria-label="Close panel"><X size={14} /></button></div>
        {rightPanel === 'chat' && <div className="ide-chat-panel"><div className="ide-chat-context"><MessageSquareText size={14} /><span>Project conversation</span></div><div className="ide-chat-history">{chatMessages.map((message) => <article className="ide-chat-message" key={idOf(message)}><span className="ide-chat-avatar">{initials(message.sender?.fullName || message.sender?.username)}</span><div><header><strong>{message.sender?.fullName || message.sender?.username || 'Teammate'}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p>{message.body}</p>{message.fileReference && <button className="ide-message-file" onClick={() => openFile(message.fileReference)}><FileCode2 size={12} /> {message.fileReference}</button>}</div></article>)}{chatMessages.length === 0 && <div className="ide-empty-chat"><MessageSquareText size={20} /><p>Start the project conversation. Reference a file from the editor to include it with your message.</p></div>}</div><form className="ide-chat-compose" onSubmit={sendMessage}><textarea value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Message the project…" maxLength={5000} disabled={!socketReady} /><div><small>{activePath ? `File: ${activePath}` : 'Messages are shared with the project'}</small><button className="button" disabled={!chatDraft.trim() || !socketReady} aria-label="Send message"><Send size={14} /></button></div></form></div>}
        {rightPanel === 'tasks' && <div className="ide-task-panel"><div className="ide-panel-subheading"><strong>Project tasks</strong><Link to={`/app/tasks?project=${projectId}`}>Open board <ChevronRight size={12} /></Link></div>{canWrite && <button className="ide-new-task" onClick={() => setShowTaskComposer((current) => !current)}><Check size={12} /> New task{activePath ? ` · ${activePath}` : ''}</button>}{showTaskComposer && <form className="ide-task-compose" onSubmit={createTask}><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Task title" maxLength={180} autoFocus /><small>{activePath ? `Linked file: ${activePath}` : 'No file linked'}</small><button className="button" disabled={!taskTitle.trim()}>Create task</button></form>}{tasks.map((task) => <article className="ide-task-card" key={idOf(task)}><span className={`ide-task-status state-${task.status?.toLowerCase().replaceAll(' ', '-')}`} /><div><strong>{task.title}</strong><small>{task.status} · {task.priority}</small>{task.linkedFilePath && <button onClick={() => openFile(task.linkedFilePath)}><FileCode2 size={11} /> {task.linkedFilePath}</button>}</div></article>)}{tasks.length === 0 && !showTaskComposer && <div className="ide-empty-chat"><Check size={20} /><p>There are no tasks for this project yet.</p><Link className="button button-quiet" to={`/app/tasks?project=${projectId}`}>Open task board</Link></div>}</div>}
        {rightPanel === 'team' && <div className="ide-team-panel"><div className="ide-panel-subheading"><strong>Project team</strong><span>{memberRows.length}</span></div>{memberRows.map((member) => { const personId = idOf(member.user); const person = member.user; const isOnline = idOf(user) === personId || Boolean(online[personId]); return <div className="ide-team-person" key={personId}><span className="ide-team-avatar">{person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person?.fullName || person?.username)}</span><span className="ide-team-name"><strong>{person?.fullName || person?.username || 'Developer'}</strong><small>{member.role} · {isOnline ? 'Online' : 'Offline'}</small></span>{canManageTeam && idOf(user) !== personId ? <select className="ide-role-select" aria-label={`Workspace access for ${person?.username || 'member'}`} value={member.workspaceRole || 'editor'} onChange={(event) => setMemberWorkspaceRole(member, event.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select> : <span className={`ide-presence ${isOnline ? 'online' : ''}`} />}</div>; })}<div className="ide-runner-note"><Users size={15} /><span>Members with editor access can edit together in real time.</span></div></div>}
      </aside>
    </section>
    {downloadDialogOpen && <div className="ide-download-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !downloadingZip) setDownloadDialogOpen(false); }}>
      <section className="ide-download-dialog" role="dialog" aria-modal="true" aria-labelledby="ide-download-title">
        <header><div><span>EXPORT WORKSPACE</span><h2 id="ide-download-title">Download as ZIP</h2></div><button type="button" className="ide-download-close" onClick={() => setDownloadDialogOpen(false)} disabled={downloadingZip} aria-label="Close download dialog"><X size={16} /></button></header>
        <p>Choose the project, a folder, or a single file. Your browser will save the ZIP to your device.</p>
        <label className="ide-download-field">What do you want to download?
          <select value={downloadScope} onChange={(event) => chooseDownloadScope(event.target.value)}>
            <option value="project">Whole project</option>
            <option value="folder" disabled={downloadFolderPaths.length === 0}>A folder</option>
            <option value="file" disabled={files.length === 0}>A file</option>
          </select>
        </label>
        {downloadScope === 'folder' && <label className="ide-download-field">Choose folder
          <select value={downloadTargetPath} onChange={(event) => setDownloadTargetPath(event.target.value)}>{downloadFolderPaths.map((folderPath) => <option key={folderPath} value={folderPath}>{folderPath}</option>)}</select>
        </label>}
        {downloadScope === 'file' && <label className="ide-download-field">Choose file
          <select value={downloadTargetPath} onChange={(event) => setDownloadTargetPath(event.target.value)}>{files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select>
        </label>}
        <div className="ide-download-actions"><button type="button" className="ide-top-button" onClick={() => setDownloadDialogOpen(false)} disabled={downloadingZip}>Cancel</button><button type="button" className="button button-small" onClick={downloadSelectionAsZip} disabled={downloadingZip || (downloadScope === 'folder' && !downloadFolderPaths.includes(downloadTargetPath)) || (downloadScope === 'file' && !files.some((file) => file.path === downloadTargetPath))}><Download size={14} /> {downloadingZip ? 'Preparing ZIP…' : 'Download ZIP'}</button></div>
      </section>
    </div>}
    {notice && <div className="ide-toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}
    <TerminalPanel open={terminalOpen} panel={bottomPanel} onPanelChange={setBottomPanel} onClose={() => setTerminalOpen(false)} configured={runtime.configured} online={runtime.online !== false} runnerMessage={runtime.message} canWrite={canWrite} theme={theme} terminals={terminalSessions} activeTerminalId={activeTerminalId} onSelectTerminal={setActiveTerminalId} onCreateTerminal={createTerminalSession} onCloseTerminal={closeTerminalSession} onShellChange={changeTerminalShell} onTranscript={appendTerminalTranscript} onHistoryChange={saveTerminalHistory} onCwdChange={saveTerminalCwd} onExecute={executeCommand} outputLines={outputLines} problems={problems} onProblemClick={(problem) => { setBottomPanel('problems'); setTerminalOpen(true); void openFile(problem.filePath); }} workspaceId={workspace?._id} ports={forwardedPorts} onForwardPort={forwardPort} onRemovePort={removeForwardedPort} />
  </main>;
}
