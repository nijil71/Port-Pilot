import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { getRunningPorts } from '../utils/ports';

export function listCommand(program: Command) {
  program
    .command('list')
    .description('List all running localhost ports')
    .action(async () => {
      try {
        console.log(chalk.blue('Scanning for running ports...'));
        const ports = await getRunningPorts();

        if (ports.length === 0) {
          console.log(chalk.yellow('No listening ports found.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Port'),
            chalk.cyan('Process Name'),
            chalk.cyan('PID')
          ],
          colWidths: [10, 30, 15]
        });

        for (const p of ports) {
          table.push([
            chalk.green(p.port.toString()),
            p.process,
            p.pid.toString()
          ]);
        }

        console.log(table.toString());
        console.log(chalk.gray(`Found ${ports.length} listening ports.`));
      } catch (error: any) {
        console.error(chalk.red('Error retrieving ports:'), error.message);
        process.exit(1);
      }
    });
}
