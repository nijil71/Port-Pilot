import { Command } from 'commander';
import { listCommand } from './commands/list';
import { killCommand } from './commands/kill';
import { tuiCommand, launchTUI } from './commands/tui';
import chalk from 'chalk';

const program = new Command();

program
  .name('port-pilot')
  .description(chalk.blue('A fast CLI tool that detects running localhost ports and lets users manage them.'))
  .version('1.0.0');

// Register commands
listCommand(program);
killCommand(program);
tuiCommand(program);

// Launch TUI by default if no command is passed, otherwise parse normally
if (!process.argv.slice(2).length) {
  launchTUI();
} else {
  program.parse(process.argv);
}
