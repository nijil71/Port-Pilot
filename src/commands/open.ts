import { Command } from 'commander';
import { exec } from 'child_process';
import chalk from 'chalk';

export function openCommand(program: Command) {
  program
    .command('open <port>')
    .description('Open localhost:<port> in your default browser')
    .action((portArg: string) => {
      const port = parseInt(portArg, 10);

      if (isNaN(port) || port <= 0 || port > 65535) {
        console.error(chalk.red('Invalid port number.'));
        process.exit(1);
      }

      const url = `http://localhost:${port}`;
      const cmd = process.platform === 'win32' ? `start ${url}`
        : process.platform === 'darwin' ? `open ${url}`
        : `xdg-open ${url}`;

      exec(cmd, (err) => {
        if (err) {
          console.error(chalk.red(`Failed to open browser: ${err.message}`));
          process.exit(1);
        }
        console.log(chalk.green(`Opened ${url}`));
      });
    });
}
