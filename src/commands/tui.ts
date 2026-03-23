import { Command } from 'commander';
import blessed from 'blessed';
import { getRunningPorts, killProcess, ProcessInfo } from '../utils/ports';

const STATUS_DEFAULT = ' ↑↓ Navigate  │  k Kill  │  f Force Kill  │  r Refresh  │  q Quit';

export async function launchTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Port Pilot',
    fullUnicode: true,
  });

  // Header
  blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: '{center}{bold}⚓ Port Pilot{/bold}{/center}',
    tags: true,
    style: { fg: 'white', bg: 'blue' },
  });

  // Status bar
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: STATUS_DEFAULT,
    tags: true,
    style: { fg: 'black', bg: 'white' },
  });

  // Loading text
  const loadingBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: 3,
    content: '{center}Scanning ports...{/center}',
    tags: true,
    style: { fg: 'yellow' },
  });

  // Confirmation dialog
  const confirmBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 50,
    height: 7,
    border: { type: 'line' },
    tags: true,
    hidden: true,
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: 'yellow' },
    },
  });

  // Table area
  const tableBox = blessed.list({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: '100%-4',
    keys: true,
    vi: false,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'cyan' },
    },
    style: {
      selected: { fg: 'black', bg: 'cyan', bold: true },
      item: { fg: 'white' },
      fg: 'white',
    },
    tags: true,
  });

  screen.render();

  let ports: ProcessInfo[] = [];
  let pendingKill: { port: ProcessInfo; force: boolean } | null = null;

  function getDisplayName(p: ProcessInfo): string {
    if (p.project && p.project !== p.process) {
      return `${p.project} (${p.process})`;
    }
    return p.process;
  }

  function pad(str: string, len: number, right = true): string {
    if (str.length >= len) return str.substring(0, len);
    const spaces = ' '.repeat(len - str.length);
    return right ? str + spaces : spaces + str;
  }

  function renderTable() {
    tableBox.clearItems();

    if (ports.length === 0) {
      tableBox.addItem('  No listening ports found.');
      tableBox.select(0);
      screen.render();
      return;
    }

    const nameW = 38;
    const portW = 8;
    const memW = 12;

    // Header
    const headerLine =
      `  ${pad('Project / Process', nameW)}` +
      `${pad('Port', portW)}` +
      `${pad('Memory', memW, false)}`;
    tableBox.addItem(`{cyan-fg}{bold}${headerLine}{/bold}{/cyan-fg}`);
    tableBox.addItem(`{gray-fg}  ${'─'.repeat(nameW + portW + memW)}{/gray-fg}`);

    for (const p of ports) {
      const name = pad(getDisplayName(p), nameW);
      const port = pad(p.port.toString(), portW);
      const mem = pad(p.memory !== undefined ? `${p.memory} MB` : '—', memW, false);

      const isNode = p.process.toLowerCase().includes('node');
      const isHighMem = p.memory !== undefined && p.memory >= 500;

      let line = `  ${name}${port}${mem}`;

      if (isHighMem) {
        line = `{red-fg}{bold}${line}{/bold}{/red-fg}`;
      } else if (isNode) {
        line = `{green-fg}${line}{/green-fg}`;
      }

      tableBox.addItem(line);
    }

    tableBox.select(2);
    screen.render();
  }

  async function refresh() {
    loadingBox.show();
    loadingBox.setContent('{center}Scanning ports...{/center}');
    screen.render();

    try {
      ports = await getRunningPorts();
    } catch {
      ports = [];
    }

    loadingBox.hide();
    renderTable();
  }

  function getSelectedPort(): ProcessInfo | null {
    const idx = (tableBox as any).selected;
    const dataIdx = idx - 2;
    if (dataIdx >= 0 && dataIdx < ports.length) {
      return ports[dataIdx];
    }
    return null;
  }

  function resetStatus() {
    statusBar.style.bg = 'white';
    statusBar.style.fg = 'black';
    statusBar.setContent(STATUS_DEFAULT);
    screen.render();
  }

  function flashStatus(msg: string, color: string, duration = 1500) {
    statusBar.setContent(` ${msg}`);
    statusBar.style.bg = color;
    statusBar.style.fg = color === 'red' ? 'white' : 'black';
    screen.render();
    setTimeout(resetStatus, duration);
  }

  // Show confirmation dialog
  function showConfirm(selected: ProcessInfo, force: boolean) {
    pendingKill = { port: selected, force };
    const action = force ? '{red-fg}FORCE KILL{/red-fg}' : '{yellow-fg}KILL{/yellow-fg}';
    const displayName = getDisplayName(selected);

    confirmBox.setContent(
      `\n  ${action} this process?\n\n` +
      `  ${displayName} on port ${selected.port}\n\n` +
      `  {green-fg}[y]{/green-fg} Yes    {red-fg}[n]{/red-fg} No`
    );
    confirmBox.show();
    confirmBox.setFront();
    screen.render();
  }

  function hideConfirm() {
    pendingKill = null;
    confirmBox.hide();
    tableBox.focus();
    screen.render();
  }

  async function executeKill(selected: ProcessInfo, force: boolean) {
    hideConfirm();

    const label = force ? 'Force killing' : 'Killing';
    statusBar.setContent(` ${label} port ${selected.port} (PID: ${selected.pid})...`);
    screen.render();

    try {
      await killProcess(selected.pid, force);
      flashStatus(`✓ Killed port ${selected.port} successfully`, 'green', 1000);
      setTimeout(() => refresh(), 1000);
    } catch (err: any) {
      flashStatus(`✗ Failed: ${err.message}`, 'red', 2500);
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
    const selected = getSelectedPort();
    if (selected) showConfirm(selected, false);
  });

  screen.key(['f'], () => {
    if (pendingKill) return;
    const selected = getSelectedPort();
    if (selected) showConfirm(selected, true);
  });

  // Confirmation keys
  screen.key(['y'], async () => {
    if (!pendingKill) return;
    await executeKill(pendingKill.port, pendingKill.force);
  });

  screen.key(['n', 'escape'], () => {
    if (!pendingKill) return;
    hideConfirm();
    flashStatus('Cancelled', 'white', 800);
  });

  tableBox.focus();
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
