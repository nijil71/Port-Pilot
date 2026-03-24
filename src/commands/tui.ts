import { Command } from 'commander';
import { exec } from 'child_process';
import blessed from 'blessed';
import path from 'path';
import { getRunningPorts, killProcess, isSystemProcess, redactCmdLine, ProcessInfo } from '../utils/ports';

const AUTO_REFRESH_MS = 3000;

type SortMode = 'port' | 'memory' | 'name';
const SORT_LABELS: Record<SortMode, string> = {
  port: 'port ↑',
  memory: 'mem ↓',
  name: 'name ↑',
};
const SORT_ORDER: SortMode[] = ['port', 'memory', 'name'];

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

  // ── Left panel ────────────────────────────────────────
  const listPanel = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '55%',
    height: '100%-3',
    border: { type: 'line' },
    label: ' {bold}Processes{/bold} ',
    tags: true,
    style: { border: { fg: '#444444' }, fg: 'white', bg: 'black' },
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
    scrollbar: { ch: '▐', style: { fg: '#333333' } },
    style: {
      selected: { fg: 'black', bg: 'cyan', bold: true },
      item: { fg: 'white', bg: 'black' },
      fg: 'white',
      bg: 'black',
    },
    tags: true,
  });

  // ── Right panel ───────────────────────────────────────
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
    style: { border: { fg: '#444444' }, fg: 'white', bg: 'black' },
  });

  // ── Search bar (hidden by default) ────────────────────
  const searchBar = blessed.textbox({
    parent: screen,
    bottom: 2,
    left: 0,
    width: '100%',
    height: 1,
    hidden: true,
    tags: false,
    inputOnFocus: true,
    style: { fg: 'white', bg: '#1a1a2e' },
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
  const footerContent = ' {cyan-fg}[k]{/cyan-fg} kill  {cyan-fg}[f]{/cyan-fg} force  {cyan-fg}[o]{/cyan-fg} open  {cyan-fg}[/]{/cyan-fg} search  {cyan-fg}[s]{/cyan-fg} sort  {cyan-fg}[r]{/cyan-fg} refresh  {cyan-fg}[q]{/cyan-fg} quit';
  blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: footerContent,
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
    style: { fg: 'white', bg: 'black', border: { fg: 'yellow' } },
  });

  screen.render();

  // ── State ─────────────────────────────────────────────
  let allPorts: ProcessInfo[] = [];
  let filteredPorts: ProcessInfo[] = [];
  let pendingKill: { entry: ProcessInfo; force: boolean } | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let isRefreshing = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSelectedPort: number | null = null;
  let sortMode: SortMode = 'port';
  let searchQuery = '';
  let isSearching = false;
  let selectedPorts = new Set<number>(); // multi-select

  // ── Helpers ───────────────────────────────────────────
  function getDisplayName(p: ProcessInfo): string {
    if (p.project && p.project !== p.process) return path.basename(p.project);
    return p.process.replace(/\.exe$/i, '');
  }

  function pad(str: string, len: number, right = true): string {
    if (str.length >= len) return str.substring(0, len);
    const gap = ' '.repeat(len - str.length);
    return right ? str + gap : gap + str;
  }

  function sortPorts(list: ProcessInfo[]): ProcessInfo[] {
    const sorted = [...list];
    switch (sortMode) {
      case 'port':
        sorted.sort((a, b) => a.port - b.port);
        break;
      case 'memory':
        sorted.sort((a, b) => (b.memory || 0) - (a.memory || 0));
        break;
      case 'name':
        sorted.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
        break;
    }
    return sorted;
  }

  function filterPorts(list: ProcessInfo[]): ProcessInfo[] {
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(p =>
      p.port.toString().includes(q) ||
      p.process.toLowerCase().includes(q) ||
      (p.project || '').toLowerCase().includes(q)
    );
  }

  function applyFilters() {
    filteredPorts = sortPorts(filterPorts(allPorts));
  }

  function updatePanelLabel() {
    const sortLabel = SORT_LABELS[sortMode];
    const searchLabel = searchQuery ? ` filter:"${searchQuery}"` : '';
    listPanel.setLabel(` {bold}Processes{/bold} {gray-fg}(${sortLabel}${searchLabel}){/gray-fg} `);
  }

  // ── Render ────────────────────────────────────────────
  function renderList(preserveSelection = true) {
    const currentIdx = (listWidget as any).selected as number;
    if (preserveSelection && filteredPorts.length > 0 && currentIdx >= 0 && currentIdx < filteredPorts.length) {
      lastSelectedPort = filteredPorts[currentIdx]?.port ?? null;
    }

    const newItems: string[] = [];
    if (filteredPorts.length === 0) {
      newItems.push('{gray-fg}  No ports match.{/gray-fg}');
    } else {
      for (const p of filteredPorts) {
        const isSelected = selectedPorts.has(p.port);
        const marker = isSelected ? '{yellow-fg}✓{/yellow-fg} ' : '  ';
        const name = pad(getDisplayName(p), 26);
        const port = pad(`:${p.port}`, 8);
        const mem = p.memory !== undefined ? `${p.memory} MB` : '';
        const base = `${marker}${name}${port}${pad(mem, 8, false)}`;

        const isSys = isSystemProcess(p);
        const isHighMem = p.memory !== undefined && p.memory >= 500;
        const isNode = p.process.toLowerCase().includes('node');

        if (isSys) {
          newItems.push(`{gray-fg}${base}{/gray-fg}`);
        } else if (isHighMem) {
          newItems.push(`{red-fg}${base}{/red-fg}`);
        } else if (isNode) {
          newItems.push(`{green-fg}${base}{/green-fg}`);
        } else {
          newItems.push(`{white-fg}${base}{/white-fg}`);
        }
      }
    }

    listWidget.clearItems();
    for (const item of newItems) {
      listWidget.addItem(item);
    }

    // Restore selection
    if (preserveSelection && lastSelectedPort !== null && filteredPorts.length > 0) {
      const newIdx = filteredPorts.findIndex(p => p.port === lastSelectedPort);
      if (newIdx >= 0) {
        listWidget.select(newIdx);
      } else {
        const clamped = Math.min(currentIdx, filteredPorts.length - 1);
        listWidget.select(Math.max(0, clamped));
      }
    } else if (filteredPorts.length > 0) {
      listWidget.select(0);
    }

    updatePanelLabel();
    updateDetail();
    screen.render();
  }

  function updateDetail() {
    const idx = (listWidget as any).selected;
    if (idx < 0 || idx >= filteredPorts.length) {
      detailPanel.setContent('\n  {gray-fg}No process selected{/gray-fg}');
      return;
    }

    const p = filteredPorts[idx];
    const displayName = getDisplayName(p);
    const isNode = p.process.toLowerCase().includes('node');
    const isSys = isSystemProcess(p);
    const nameColor = isSys ? 'gray' : isNode ? 'green' : 'cyan';
    const memStr = p.memory !== undefined ? `${p.memory} MB` : 'Unknown';
    const memColor = (p.memory || 0) >= 500 ? 'red' : 'white';

    let cmdDisplay = redactCmdLine(p.cmdLine || p.process);
    if (cmdDisplay.length > 60) cmdDisplay = '...' + cmdDisplay.slice(-57);

    const sysTag = isSys ? '  {yellow-fg}⚠ system process{/yellow-fg}\n' : '';

    detailPanel.setContent([
      '',
      `  {${nameColor}-fg}{bold}${displayName}{/bold}{/${nameColor}-fg}`,
      sysTag,
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
      `  {gray-fg}${cmdDisplay}{/gray-fg}`,
    ].join('\n'));
  }

  listWidget.on('select item', () => {
    if (!pendingKill && !isSearching) {
      updateDetail();
      screen.render();
    }
  });

  // ── Refresh ───────────────────────────────────────────
  async function refresh(silent = false) {
    if (isRefreshing) return;
    isRefreshing = true;

    if (!silent) setStatus('Scanning ports...', 'yellow');

    try {
      allPorts = await getRunningPorts();
    } catch {
      if (!silent && allPorts.length === 0) allPorts = [];
    }

    isRefreshing = false;
    applyFilters();

    // Clean up multi-select for disappeared ports
    const activePorts = new Set(allPorts.map(p => p.port));
    for (const sp of selectedPorts) {
      if (!activePorts.has(sp)) selectedPorts.delete(sp);
    }

    setStatus(`${filteredPorts.length}/${allPorts.length} ports`, 'gray');
    renderList(true);
  }

  function setStatus(msg: string, color: string) {
    statusLine.setContent(` {${color}-fg}${msg}{/${color}-fg}`);
    screen.render();
  }

  function flashStatus(msg: string, color: string, duration = 1500) {
    if (statusTimer) clearTimeout(statusTimer);
    setStatus(msg, color);
    statusTimer = setTimeout(() => {
      setStatus(`${filteredPorts.length}/${allPorts.length} ports`, 'gray');
      statusTimer = null;
    }, duration);
  }

  function getSelectedPort(): ProcessInfo | null {
    const idx = (listWidget as any).selected;
    if (idx >= 0 && idx < filteredPorts.length) return filteredPorts[idx];
    return null;
  }

  // ── Auto-refresh ──────────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      if (pendingKill || isRefreshing || isSearching) return;
      refresh(true);
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // ── Open in browser ───────────────────────────────────
  function openInBrowser(port: number) {
    const url = `http://localhost:${port}`;
    const cmd = process.platform === 'win32' ? `start ${url}`
      : process.platform === 'darwin' ? `open ${url}`
      : `xdg-open ${url}`;
    exec(cmd, () => {});
    flashStatus(`Opened localhost:${port}`, 'cyan', 1200);
  }

  // ── Confirmation ──────────────────────────────────────
  function showConfirm(targets: ProcessInfo[], force: boolean) {
    stopAutoRefresh();

    // Block system process kills
    const sysTargets = targets.filter(t => isSystemProcess(t));
    if (sysTargets.length > 0) {
      flashStatus(`⚠ Cannot kill system process${sysTargets.length > 1 ? 'es' : ''}`, 'yellow', 2000);
      return;
    }

    pendingKill = { entry: targets[0], force };
    const action = force ? '{red-fg}{bold}FORCE KILL{/bold}{/red-fg}' : '{yellow-fg}{bold}KILL{/bold}{/yellow-fg}';

    let body: string;
    if (targets.length === 1) {
      const t = targets[0];
      body = `   ${getDisplayName(t)} {gray-fg}on port{/gray-fg} {bold}${t.port}{/bold}\n   {gray-fg}PID ${t.pid}{/gray-fg}`;
    } else {
      body = `   {bold}${targets.length} processes{/bold} selected`;
      // store all targets in pendingKill via closure
      pendingKill = { entry: targets[0], force }; // we'll use batchTargets below
    }

    confirmBox.setContent(
      `\n   ${action} process${targets.length > 1 ? 'es' : ''}?\n\n${body}\n\n   {green-fg}[y]{/green-fg} confirm    {red-fg}[n]{/red-fg} cancel`
    );
    confirmBox.show();
    confirmBox.setFront();

    // Store batch targets in a closure-accessible variable
    (confirmBox as any)._batchTargets = targets;
    screen.render();
  }

  function hideConfirm() {
    pendingKill = null;
    (confirmBox as any)._batchTargets = null;
    confirmBox.hide();
    listWidget.focus();
    startAutoRefresh();
    screen.render();
  }

  async function executeKill(targets: ProcessInfo[], force: boolean) {
    hideConfirm();
    const label = force ? 'Force killing' : 'Killing';
    setStatus(`${label} ${targets.length} process${targets.length > 1 ? 'es' : ''}...`, 'yellow');

    let killed = 0;
    let failed = 0;
    for (const t of targets) {
      try {
        await killProcess(t.pid, force);
        killed++;
        selectedPorts.delete(t.port);
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      flashStatus(`✓ ${killed} killed, ✗ ${failed} failed`, killed > 0 ? 'yellow' : 'red', 2000);
    } else {
      flashStatus(`✓ Killed ${killed} process${killed > 1 ? 'es' : ''}`, 'green', 1200);
    }
    setTimeout(() => refresh(false), 600);
  }

  // ── Search ────────────────────────────────────────────
  function enterSearch() {
    isSearching = true;
    stopAutoRefresh();
    searchBar.show();
    searchBar.setValue(searchQuery);
    searchBar.focus();
    screen.render();
  }

  function exitSearch() {
    isSearching = false;
    searchBar.hide();
    listWidget.focus();
    startAutoRefresh();
    applyFilters();
    renderList(false);
  }

  searchBar.on('submit', () => {
    searchQuery = searchBar.getValue().trim();
    exitSearch();
  });

  searchBar.on('cancel', () => {
    searchQuery = '';
    exitSearch();
  });

  searchBar.key(['escape'], () => {
    searchQuery = '';
    exitSearch();
  });

  // ── Key bindings ──────────────────────────────────────
  screen.key(['q', 'C-c'], () => {
    stopAutoRefresh();
    screen.destroy();
    process.exit(0);
  });

  screen.key(['r'], async () => {
    if (pendingKill || isSearching) return;
    await refresh(false);
  });

  screen.key(['/'], () => {
    if (pendingKill || isSearching) return;
    enterSearch();
  });

  screen.key(['s'], () => {
    if (pendingKill || isSearching) return;
    const idx = SORT_ORDER.indexOf(sortMode);
    sortMode = SORT_ORDER[(idx + 1) % SORT_ORDER.length];
    applyFilters();
    renderList(true);
    flashStatus(`Sort: ${SORT_LABELS[sortMode]}`, 'cyan', 800);
  });

  screen.key(['o'], () => {
    if (pendingKill || isSearching) return;
    const s = getSelectedPort();
    if (s) openInBrowser(s.port);
  });

  screen.key(['space'], () => {
    if (pendingKill || isSearching) return;
    const s = getSelectedPort();
    if (!s) return;

    if (selectedPorts.has(s.port)) {
      selectedPorts.delete(s.port);
    } else {
      selectedPorts.add(s.port);
    }
    renderList(true);
  });

  screen.key(['k'], () => {
    if (pendingKill || isSearching) return;
    const targets = getKillTargets();
    if (targets.length > 0) showConfirm(targets, false);
  });

  screen.key(['f'], () => {
    if (pendingKill || isSearching) return;
    const targets = getKillTargets();
    if (targets.length > 0) showConfirm(targets, true);
  });

  function getKillTargets(): ProcessInfo[] {
    if (selectedPorts.size > 0) {
      return filteredPorts.filter(p => selectedPorts.has(p.port));
    }
    const s = getSelectedPort();
    return s ? [s] : [];
  }

  screen.key(['y'], async () => {
    if (!pendingKill) return;
    const targets = (confirmBox as any)._batchTargets as ProcessInfo[] || [pendingKill.entry];
    await executeKill(targets, pendingKill.force);
  });

  screen.key(['n', 'escape'], () => {
    if (isSearching) return; // handled by searchBar
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
    .action(async () => { await launchTUI(); });
}
