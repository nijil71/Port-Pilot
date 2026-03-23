import { Command } from 'commander';
import blessed from 'blessed';
import { getRunningPorts, killProcess, ProcessInfo } from '../utils/ports';

const FOOTER_TEXT = ' {cyan-fg}[k]{/cyan-fg} kill   {cyan-fg}[f]{/cyan-fg} force kill   {cyan-fg}[r]{/cyan-fg} refresh   {cyan-fg}[q]{/cyan-fg} quit';

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

  // ── Status line (above footer) ────────────────────────
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
  const footer = blessed.box({
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

  function getDisplayName(p: ProcessInfo): string {
    if (p.project && p.project !== p.process) {
      return `${p.project}`;
    }
    return p.process.replace(/\.exe$/i, '');
  }

  function pad(str: string, len: number, right = true): string {
    if (str.length >= len) return str.substring(0, len);
    const gap = ' '.repeat(len - str.length);
    return right ? str + gap : gap + str;
  }

  function renderList() {
    listWidget.clearItems();

    if (ports.length === 0) {
      listWidget.addItem('{gray-fg}  No listening ports found.{/gray-fg}');
      listWidget.select(0);
      screen.render();
      return;
    }

    for (const p of ports) {
      const name = pad(getDisplayName(p), 28);
      const port = pad(`:${p.port}`, 8);
      const mem = p.memory !== undefined ? `${p.memory} MB` : '';

      const isNode = p.process.toLowerCase().includes('node');
      const isHighMem = p.memory !== undefined && p.memory >= 500;

      let line = `${name} ${port} ${pad(mem, 8, false)}`;

      if (isHighMem) {
        line = `{red-fg}${line}{/red-fg}`;
      } else if (isNode) {
        line = `{green-fg}${line}{/green-fg}`;
      } else {
        line = `{white-fg}${line}{/white-fg}`;
      }

      listWidget.addItem(line);
    }

    listWidget.select(0);
    updateDetail();
    screen.render();
  }

  function updateDetail() {
    const idx = (listWidget as any).selected;
    if (idx < 0 || idx >= ports.length) {
      detailPanel.setContent('\n  {gray-fg}No process selected{/gray-fg}');
      screen.render();
      return;
    }

    const p = ports[idx];
    const displayName = getDisplayName(p);
    const isNode = p.process.toLowerCase().includes('node');

    const nameColor = isNode ? 'green' : 'cyan';
    const memStr = p.memory !== undefined ? `${p.memory} MB` : 'Unknown';
    const memColor = (p.memory || 0) >= 500 ? 'red' : 'white';

    // Extract working directory from cmdLine
    let processPath = p.cmdLine || p.process;
    // Truncate for display if very long
    if (processPath.length > 60) {
      processPath = '...' + processPath.slice(-57);
    }

    const lines = [
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
    ];

    detailPanel.setContent(lines.join('\n'));
    screen.render();
  }

  // Listen for selection changes
  listWidget.on('select item', () => {
    if (!pendingKill) updateDetail();
  });

  async function refresh() {
    statusLine.setContent(' {yellow-fg}Scanning ports...{/yellow-fg}');
    screen.render();

    try {
      ports = await getRunningPorts();
    } catch {
      ports = [];
    }

    statusLine.setContent(` {gray-fg}${ports.length} ports found{/gray-fg}`);
    renderList();
  }

  function getSelectedPort(): ProcessInfo | null {
    const idx = (listWidget as any).selected;
    if (idx >= 0 && idx < ports.length) {
      return ports[idx];
    }
    return null;
  }

  function flashStatus(msg: string, color: string, duration = 1500) {
    statusLine.setContent(` {${color}-fg}${msg}{/${color}-fg}`);
    screen.render();
    setTimeout(() => {
      statusLine.setContent(` {gray-fg}${ports.length} ports found{/gray-fg}`);
      screen.render();
    }, duration);
  }

  // ── Confirmation flow ─────────────────────────────────
  function showConfirm(selected: ProcessInfo, force: boolean) {
    pendingKill = { entry: selected, force };
    const action = force ? '{red-fg}{bold}FORCE KILL{/bold}{/red-fg}' : '{yellow-fg}{bold}KILL{/bold}{/yellow-fg}';
    const displayName = getDisplayName(selected);

    confirmBox.setContent(
      `\n` +
      `   ${action} process?\n\n` +
      `   ${displayName} {gray-fg}on port{/gray-fg} {bold}${selected.port}{/bold}\n` +
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
    screen.render();
  }

  async function executeKill(selected: ProcessInfo, force: boolean) {
    hideConfirm();

    const label = force ? 'Force killing' : 'Killing';
    statusLine.setContent(` {yellow-fg}${label} port ${selected.port}...{/yellow-fg}`);
    screen.render();

    try {
      await killProcess(selected.pid, force);
      flashStatus(`✓ Killed port ${selected.port}`, 'green', 1200);
      setTimeout(() => refresh(), 1200);
    } catch (err: any) {
      flashStatus(`✗ ${err.message}`, 'red', 2500);
    }
  }

  // ── Key bindings ──────────────────────────────────────
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.key(['r'], async () => {
    if (pendingKill) return;
    await refresh();
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

  listWidget.focus();
  await refresh();
}

export function tuiCommand(program: Command) {
  program
    .command('ui')
    .description('Interactive TUI for managing ports')
    .action(async () => {
      await launchTUI();
    });
}
