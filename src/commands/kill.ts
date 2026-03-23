import { Command } from 'commander';
import chalk from 'chalk';
import { getRunningPorts, killProcess } from '../utils/ports';

export function killCommand(program: Command) {
  program
    .command('kill <port>')
    .description('Kill the process running on the specified port')
    .option('-f, --force', 'Forcefully kill the process')
    .action(async (portArg: string, options: { force?: boolean }) => {
      const port = parseInt(portArg, 10);
      
      if (isNaN(port) || port <= 0) {
        console.error(chalk.red('Invalid port number specified.'));
        process.exit(1);
      }
      
      try {
        console.log(chalk.blue(`Looking for process on port ${port}...`));
        const ports = await getRunningPorts();
        const target = ports.find(p => p.port === port);
        
        if (!target) {
          console.log(chalk.yellow(`No listening process found on port ${port}.`));
          return;
        }
        
        console.log(chalk.gray(`Found process ${target.process} (PID: ${target.pid}) on port ${port}.`));
        
        try {
          await killProcess(target.pid, !!options.force);
          console.log(chalk.green(`Successfully killed process on port ${port}.`));
        } catch (error: any) {
          if (error.code === 'EPERM' || error.message.includes('Access is denied') || error.message.includes('EPERM')) {
            console.error(chalk.red(`Permission denied. Try running with elevated privileges (sudo/Administrator).`));
          } else if (error.code === 'ESRCH' || error.message.includes('not found')) {
            console.error(chalk.red(`Process not found. It may have already terminated.`));
          } else {
            console.error(chalk.red(`Failed to kill process: ${error.message}`));
          }
          process.exit(1);
        }
      } catch (error: any) {
        console.error(chalk.red('Error looking up ports:'), error.message);
        process.exit(1);
      }
    });
}
