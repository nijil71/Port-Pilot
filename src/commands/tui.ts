import { Command } from 'commander';
import blessed from 'blessed';
import { getRunningPorts, killProcess, ProcessInfo } from '../utils/ports';

const FOOTER_TEXT = ' {cyan-fg}[k]{/cyan-fg} kill   {cyan-fg}[f]{/cyan-fg} force kill   {cyan-fg}[r]{/cyan-fg} refresh   {cyan-fg}[q]{/cyan-fg} quit';
const AUTO_REFRESH_MS = 3000;

export async function launchTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Port Pilot',
    fullUnicode: true,
  });

  // ── Header ────────────────────────────────────────────
  blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' {bold}⚓ port-pilot{/bold}',
    tags: true,
    style: { fg: 'cyan', bg: 'black' },
  });

  // ── Left panel: process list ──────────────────────────
  const listPanel = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '55%',
    height: '100%-3',
    border: { type: 'line' },
    label: ' {bold}Processes{/bold} ',
    tags: true,
    style: {
      border: { fg: '#444444' },
      fg: 'white',
      bg: 'black',
    },
  });

  const listWidget = blessed.list({
    parent: listPanel,
    top: 0,
    left: 1,
    width: '100%-4',
    height: '100%-2',
    keys: true,
    vi: false,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '▐',
      style: { fg: '#333333' },
    },
    style: {
      selected: { fg: 'black', bg: 'cyan', bold: true },
      item: { fg: 'white', bg: 'black' },
      fg: 'white',
      bg: 'black',
    },
    tags: true,
  });

  // ── Right panel: detail view ──────────────────────────
  const detailPanel = blessed.box({
    parent: screen,
    top: 1,
    left: '55%',
    width: '45%',
    height: '100%-3',
    border: { type: 'line' },
    label: ' {bold}Details{/bold} ',
    tags: true,
    scrollable: true,
    style: {
      border: { fg: '#444444' },
      fg: 'white',
      bg: 'black',
    },
  });

  // ── Status line ───────────────────────────────────────
  const statusLine = blessed.box({
    parent: screen,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    content: '',
    tags: true,
    style: { fg: 'white', bg: 'black' },
  });

  // ── Footer ────────────────────────────────────────────
  blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: FOOTER_TEXT,
    tags: true,
    style: { fg: 'white', bg: '#1a1a1a' },
  });

  // ── Confirmation dialog ───────────────────────────────
  const confirmBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 52,
    height: 9,
    border: { type: 'line' },
    label: ' {bold}Confirm{/bold} ',
    tags: true,
    hidden: true,
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: 'yellow' },
    },
  });

  screen.render();

  // ── State ─────────────────────────────────────────────
  let ports: ProcessInfo[] = [];
  let pendingKill: { entry: ProcessInfo; force: boolean } | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let isRefreshing = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSelectedPort: number | null = null; // track by port number

  // ── Helpers ───────────────────────────────────────────
  function getDisplayName(p: ProcessInfo): string {
    if (p.project && p.project !== p.process) {
      return p.project;
    }
    return p.process.replace(/\.exe$/i, '');
  }

  function pad(str: string, len: number, right = true): string {
    if (str.length >= len) return str.substring(0, len);
    const gap = ' '.repeat(len - str.length);
    return right ? str + gap : gap + str;
  }

  function buildLine(p: ProcessInfo): string {
    const name = pad(getDisplayName(p), 28);
    const port = pad(`:${p.port}`, 8);
    const mem = p.memory !== undefined ? `${p.memory} MB` : '';
    const base = `${name} ${port} ${pad(mem, 8, false)}`;

    const isHighMem = p.memory !== undefined && p.memory >= 500;
    const isNode = p.process.toLowerCase().includes('node');

    if (isHighMem) return `{red-fg}${base}{/red-fg}`;
    if (isNode) return `{green-fg}${base}{/green-fg}`;
    return `{white-fg}${base}{/white-fg}`;
  }

  // ── Diff-based render (no flicker) ────────────────────
  function renderList(preserveSelection = true) {
    // Save current selection by port number
    const currentIdx = (listWidget as any).selected as number;
    if (preserveSelection && ports.length > 0 && currentIdx >= 0 && currentIdx < ports.length) {
      lastSelectedPort = ports[currentIdx]?.port ?? null;
    }

    // Build new items
    const newItems: string[] = [];
    if (ports.length === 0) {
      newItems.push('{gray-fg}  No listening ports found.{/gray-fg}');
    } else {
      for (const p of ports) {
        newItems.push(buildLine(p));
      }
    }

    // Only update items that changed to prevent flicker
    const existingCount = (listWidget as any).items?.length ?? 0;
    const needsFullRebuild =
      existingCount !== newItems.length ||
      newItems.some((item, i) => {
        const existing = (listWidget as any).items?.[i];
        if (!existing) return true;
        const existingContent = (existing as any).content || '';
        const stripped = item.replace(/\{[^}]+\}/g, '');
        return existingContent !== stripped;
      });

    if (needsFullRebuild) {
      listWidget.clearItems();
      for (const item of newItems) {
        listWidget.addItem(item);
      }
    }

    // Restore selection
    if (preserveSelection && lastSelectedPort !== null && ports.length > 0) {
      const newIdx = ports.findIndex(p => p.port === lastSelectedPort);
      if (newIdx >= 0) {
        listWidget.select(newIdx);
      } else {
        // Port disappeared — clamp to valid range
        const clampedIdx = Math.min(currentIdx, ports.length - 1);
        listWidget.select(Math.max(0, clampedIdx));
        lastSelectedPort = ports[Math.max(0, clampedIdx)]?.port ?? null;
      }
    } else if (ports.length > 0) {
      listWidget.select(0);
      lastSelectedPort = ports[0]?.port ?? null;
    }

    updateDetail();
    screen.render();
  }

  function updateDetail() {
    const idx = (listWidget as any).selected;
    if (idx < 0 || idx >= ports.length) {
      detailPanel.setContent('\n  {gray-fg}No process selected{/gray-fg}');
      return;
    }

    const p = ports[idx];
    const displayName = getDisplayName(p);
    const isNode = p.process.toLowerCase().includes('node');
    const nameColor = isNode ? 'green' : 'cyan';
    const memStr = p.memory !== undefined ? `${p.memory} MB` : 'Unknown';
    const memColor = (p.memory || 0) >= 500 ? 'red' : 'white';

    let processPath = p.cmdLine || p.process;
    if (processPath.length > 60) {
      processPath = '...' + processPath.slice(-57);
    }

    detailPanel.setContent([
      '',
      `  {${nameColor}-fg}{bold}${displayName}{/bold}{/${nameColor}-fg}`,
      '',
      `  {gray-fg}PORT{/gray-fg}      {bold}${p.port}{/bold}`,
      '',
      `  {gray-fg}PID{/gray-fg}       {bold}${p.pid}{/bold}`,
      '',
      `  {gray-fg}PROCESS{/gray-fg}   ${p.process}`,
      '',
      `  {gray-fg}MEMORY{/gray-fg}    {${memColor}-fg}${memStr}{/${memColor}-fg}`,
      '',
      `  {gray-fg}STATUS{/gray-fg}    {green-fg}● listening{/green-fg}`,
      '',
      `  {gray-fg}CMD{/gray-fg}`,
      `  {gray-fg}${processPath}{/gray-fg}`,
    ].join('\n'));
  }

  // Listen for selection changes
  listWidget.on('select item', () => {
    if (!pendingKill) {
      updateDetail();
      screen.render();
    }
  });

  // ── Refresh logic ─────────────────────────────────────
  async function refresh(silent = false) {
    if (isRefreshing) return; // debounce concurrent calls
    isRefreshing = true;

    if (!silent) {
      setStatus('Scanning ports...', 'yellow');
    }

    try {
      const newPorts = await getRunningPorts();
      ports = newPorts;
    } catch {
      // Keep existing data on error during auto-refresh
      if (!silent && ports.length === 0) {
        ports = [];
      }
    }

    isRefreshing = false;
    setStatus(`${ports.length} port${ports.length !== 1 ? 's' : ''} found`, 'gray');
    renderList(true);
  }

  // ── Status management ─────────────────────────────────
  function setStatus(msg: string, color: string) {
    statusLine.setContent(` {${color}-fg}${msg}{/${color}-fg}`);
    screen.render();
  }

  function flashStatus(msg: string, color: string, duration = 1500) {
    if (statusTimer) clearTimeout(statusTimer);
    setStatus(msg, color);
    statusTimer = setTimeout(() => {
      setStatus(`${ports.length} port${ports.length !== 1 ? 's' : ''} found`, 'gray');
      statusTimer = null;
    }, duration);
  }

  function getSelectedPort(): ProcessInfo | null {
    const idx = (listWidget as any).selected;
    if (idx >= 0 && idx < ports.length) {
      return ports[idx];
    }
    return null;
  }

  // ── Auto-refresh timer ────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      // Skip auto-refresh if confirm dialog is open or a kill is in progress
      if (pendingKill || isRefreshing) return;
      refresh(true);
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // ── Confirmation flow ─────────────────────────────────
  function showConfirm(selected: ProcessInfo, force: boolean) {
    stopAutoRefresh(); // pause while dialog is open
    pendingKill = { entry: selected, force };

    const action = force
      ? '{red-fg}{bold}FORCE KILL{/bold}{/red-fg}'
      : '{yellow-fg}{bold}KILL{/bold}{/yellow-fg}';

    confirmBox.setContent(
      `\n` +
      `   ${action} process?\n\n` +
      `   ${getDisplayName(selected)} {gray-fg}on port{/gray-fg} {bold}${selected.port}{/bold}\n` +
      `   {gray-fg}PID ${selected.pid}{/gray-fg}\n\n` +
      `   {green-fg}[y]{/green-fg} confirm    {red-fg}[n]{/red-fg} cancel`
    );
    confirmBox.show();
    confirmBox.setFront();
    screen.render();
  }

  function hideConfirm() {
    pendingKill = null;
    confirmBox.hide();
    listWidget.focus();
    startAutoRefresh(); // resume
    screen.render();
  }

  async function executeKill(selected: ProcessInfo, force: boolean) {
    hideConfirm();

    const label = force ? 'Force killing' : 'Killing';
    setStatus(`${label} port ${selected.port}...`, 'yellow');

    try {
      await killProcess(selected.pid, force);
      flashStatus(`✓ Killed port ${selected.port}`, 'green', 1200);
      // Immediate refresh after kill so list updates fast
      setTimeout(() => refresh(false), 600);
    } catch (err: any) {
      const msg = err.message || 'Unknown error';
      if (msg.includes('EPERM') || msg.includes('Access')) {
        flashStatus(`✗ Permission denied — try running as admin`, 'red', 3000);
      } else if (msg.includes('ESRCH') || msg.includes('not found')) {
        flashStatus(`✗ Process already terminated`, 'yellow', 1500);
        setTimeout(() => refresh(false), 500);
      } else {
        flashStatus(`✗ ${msg}`, 'red', 2500);
      }
    }
  }

  // ── Key bindings ──────────────────────────────────────
  screen.key(['q', 'C-c'], () => {
    stopAutoRefresh();
    screen.destroy();
    process.exit(0);
  });

  screen.key(['r'], async () => {
    if (pendingKill) return;
    await refresh(false);
  });

  screen.key(['k'], () => {
    if (pendingKill) return;
    const s = getSelectedPort();
    if (s) showConfirm(s, false);
  });

  screen.key(['f'], () => {
    if (pendingKill) return;
    const s = getSelectedPort();
    if (s) showConfirm(s, true);
  });

  screen.key(['y'], async () => {
    if (!pendingKill) return;
    await executeKill(pendingKill.entry, pendingKill.force);
  });

  screen.key(['n', 'escape'], () => {
    if (!pendingKill) return;
    hideConfirm();
    flashStatus('Cancelled', 'gray', 800);
  });

  // ── Boot ──────────────────────────────────────────────
  listWidget.focus();
  await refresh(false);
  startAutoRefresh();
}

export function tuiCommand(program: Command) {
  program
    .command('ui')
    .description('Interactive TUI for managing ports')
    .action(async () => {
      await launchTUI();
    });
}
