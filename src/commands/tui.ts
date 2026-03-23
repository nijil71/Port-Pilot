import { Command } from 'commander';
import blessed from 'blessed';
import { getRunningPorts, killProcess, ProcessInfo } from '../utils/ports';

export function tuiCommand(program: Command) {
  program
    .command('ui')
    .description('Interactive TUI for managing ports')
    .action(async () => {
      const screen = blessed.screen({
        smartCSR: true,
        title: 'Port Pilot',
        fullUnicode: true,
      });

      // Header
      const header = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: 3,
        content: '{center}{bold}⚓ Port Pilot{/bold}{/center}',
        tags: true,
        style: {
          fg: 'white',
          bg: 'blue',
        },
      });

      // Status bar
      const statusBar = blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        content: ' ↑↓ Navigate  │  k Kill  │  K Force Kill  │  r Refresh  │  q Quit',
        tags: true,
        style: {
          fg: 'black',
          bg: 'white',
        },
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

      screen.render();

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
          selected: {
            fg: 'black',
            bg: 'cyan',
            bold: true,
          },
          item: {
            fg: 'white',
          },
          fg: 'white',
        },
        tags: true,
      });

      let ports: ProcessInfo[] = [];

      function getDisplayName(p: ProcessInfo): string {
        if (p.project && p.project !== p.process) {
          return `${p.project} (${p.process})`;
        }
        return p.process;
      }

      function padRight(str: string, len: number): string {
        if (str.length >= len) return str.substring(0, len);
        return str + ' '.repeat(len - str.length);
      }

      function padLeft(str: string, len: number): string {
        if (str.length >= len) return str.substring(0, len);
        return ' '.repeat(len - str.length) + str;
      }

      function renderTable() {
        tableBox.clearItems();

        if (ports.length === 0) {
          tableBox.addItem('  No listening ports found.');
          tableBox.select(0);
          screen.render();
          return;
        }

        // Column widths
        const nameW = 38;
        const portW = 8;
        const memW = 12;

        // Header row
        const headerLine =
          `  ${padRight('Project / Process', nameW)}` +
          `${padRight('Port', portW)}` +
          `${padLeft('Memory', memW)}`;
        tableBox.addItem(`{cyan-fg}{bold}${headerLine}{/bold}{/cyan-fg}`);

        const separator = '  ' + '─'.repeat(nameW + portW + memW);
        tableBox.addItem(`{gray-fg}${separator}{/gray-fg}`);

        for (const p of ports) {
          const name = padRight(getDisplayName(p), nameW);
          const port = padRight(p.port.toString(), portW);
          const mem = padLeft(p.memory !== undefined ? `${p.memory} MB` : '—', memW);

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

        // Select first data row (skip header + separator)
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
        // Subtract 2 for header + separator
        const dataIdx = idx - 2;
        if (dataIdx >= 0 && dataIdx < ports.length) {
          return ports[dataIdx];
        }
        return null;
      }

      // Kill selected port
      async function killSelected(force: boolean) {
        const selected = getSelectedPort();
        if (!selected) return;

        const label = force ? 'Force killing' : 'Killing';
        statusBar.setContent(` ${label} process on port ${selected.port} (PID: ${selected.pid})...`);
        screen.render();

        try {
          await killProcess(selected.pid, force);
          statusBar.setContent(` ✓ Killed port ${selected.port} successfully. Refreshing...`);
          statusBar.style.bg = 'green';
          screen.render();
          setTimeout(async () => {
            statusBar.style.bg = 'white';
            statusBar.setContent(' ↑↓ Navigate  │  k Kill  │  K Force Kill  │  r Refresh  │  q Quit');
            await refresh();
          }, 800);
        } catch (err: any) {
          statusBar.setContent(` ✗ Failed: ${err.message}`);
          statusBar.style.bg = 'red';
          statusBar.style.fg = 'white';
          screen.render();
          setTimeout(() => {
            statusBar.style.bg = 'white';
            statusBar.style.fg = 'black';
            statusBar.setContent(' ↑↓ Navigate  │  k Kill  │  K Force Kill  │  r Refresh  │  q Quit');
            screen.render();
          }, 2000);
        }
      }

      // Key bindings
      screen.key(['q', 'C-c'], () => {
        screen.destroy();
        process.exit(0);
      });

      screen.key(['r'], async () => {
        await refresh();
      });

      screen.key(['k'], async () => {
        await killSelected(false);
      });

      screen.key(['S-k'], async () => {
        await killSelected(true);
      });

      tableBox.focus();
      await refresh();
    });
}
