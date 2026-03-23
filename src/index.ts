import { Command } from 'commander';
import { listCommand } from './commands/list';
import { killCommand } from './commands/kill';
import chalk from 'chalk';

const program = new Command();

program
  .name('port-pilot')
  .description(chalk.blue('A fast CLI tool that detects running localhost ports and lets users manage them.'))
  .version('1.0.0');

// Register commands
listCommand(program);
killCommand(program);

// Parse the arguments
program.parse(process.argv);

// Output help by default if no command is passed
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
