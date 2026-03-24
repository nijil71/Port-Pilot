import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { getRunningPorts } from '../utils/ports';

export function listCommand(program: Command) {
  program
    .command('list')
    .description('List all running localhost ports')
    .option('--json', 'Output as JSON for scripting')
    .action(async (options: { json?: boolean }) => {
      try {
        console.log(chalk.blue('Scanning for running ports...'));
        const ports = await getRunningPorts();

        if (options.json) {
          console.log(JSON.stringify(ports, null, 2));
          return;
        }

        if (ports.length === 0) {
          console.log(chalk.yellow('No listening ports found.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan.bold('Port'),
            chalk.cyan.bold('Process'),
            chalk.cyan.bold('PID'),
            chalk.cyan.bold('Memory (MB)')
          ]
        });

        for (const p of ports) {
          const isNode = p.process.toLowerCase().includes('node');
          const isHighMem = p.memory && p.memory >= 500;

          let displayName = p.project && p.project !== p.process 
            ? `${p.project} (${p.process})` 
            : p.process;

          let processName = isNode ? chalk.green.bold(displayName) : displayName;
          let memoryStr = p.memory !== undefined ? `${p.memory} MB` : 'Unknown';
          
          if (isHighMem) {
            memoryStr = chalk.red.bold(memoryStr);
            processName = chalk.yellow.bold(processName);
          } else if (p.memory !== undefined) {
            memoryStr = chalk.gray(memoryStr);
          } else {
            memoryStr = chalk.dim(memoryStr);
          }

          table.push([
            chalk.blueBright(p.port.toString()),
            processName,
            chalk.gray(p.pid.toString()),
            memoryStr
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
