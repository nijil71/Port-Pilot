import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProcessInfo {
  port: number;
  pid: number;
  process: string;
  project?: string;
  memory?: number;
  cmdLine?: string;
}

export async function killProcess(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    const args = ['/PID', pid.toString()];
    if (force) args.push('/F');
    await execAsync(`taskkill ${args.join(' ')}`);
  } else {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  }
}

export async function getRunningPorts(): Promise<ProcessInfo[]> {
  const platform = process.platform;
  
  if (platform === 'win32') {
    return getWindowsPorts();
  } else if (platform === 'darwin' || platform === 'linux') {
    return getUnixPorts();
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function getWindowsPorts(): Promise<ProcessInfo[]> {
  const processes: ProcessInfo[] = [];
  const pids = new Set<number>();
  
  try {
    const { stdout: netstatOut } = await execAsync('netstat -ano | findstr LISTENING');
    const lines = netstatOut.split('\n');
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[3] === 'LISTENING') {
        const localAddress = parts[1];
        const portStr = localAddress.split(':').pop();
        const pidStr = parts[4];
        
        if (portStr && pidStr) {
          const port = parseInt(portStr, 10);
          const pid = parseInt(pidStr, 10);
          if (!isNaN(port) && !isNaN(pid) && port > 0) {
            processes.push({ port, pid, process: 'Unknown' });
            pids.add(pid);
          }
        }
      }
    }
    
    if (pids.size > 0) {
      try {
        const { stdout: tasklistOut } = await execAsync('tasklist /FO CSV');
        const tasks = tasklistOut.split('\n');
        const pidMap = new Map<number, { name: string; memory: number }>();
        
        for (let i = 1; i < tasks.length; i++) {
          const taskLine = tasks[i].trim();
          if (!taskLine) continue;
          
          const csvParts = taskLine.split('","').map(s => s.replace(/(^"|"$)/g, ''));
          if (csvParts.length >= 5) {
            const name = csvParts[0];
            const pid = parseInt(csvParts[1], 10);
            const memK = parseInt(csvParts[4].replace(/[^\d]/g, ''), 10);
            
            if (!isNaN(pid)) {
              pidMap.set(pid, { name, memory: isNaN(memK) ? 0 : Math.round(memK / 1024) });
            }
          }
        }
        
        for (const p of processes) {
          if (pidMap.has(p.pid)) {
            const info = pidMap.get(p.pid)!;
            p.process = info.name;
            p.memory = info.memory;
          }
        }
      } catch (err) {
        // Fallback: tasklist failed, just return processes with 'Unknown'
      }
    }
    
    // De-duplicate based on port
    const unique = new Map<number, ProcessInfo>();
    for (const p of processes) {
      unique.set(p.port, p);
    }
    
    await enrichWithCommandLines(Array.from(unique.values()));
    return Array.from(unique.values()).sort((a, b) => a.port - b.port);
    
  } catch (error) {
    if ((error as any).code === 1) {
      // findstr didn't find anything
      return [];
    }
    throw error;
  }
}

async function getUnixPorts(): Promise<ProcessInfo[]> {
  try {
    // We try lsof first. It works on macOS and most Linux distros
    const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN -P -n');
    const lines = stdout.split('\n');
    const processes: ProcessInfo[] = [];
    const uniquePorts = new Set<number>();
    
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(/\s+/);
      if (parts.length >= 9) {
        const command = parts[0];
        const pidStr = parts[1];
        const namePart = parts.slice(8).join(' '); // Typically like "*:3000 (LISTEN)"
        
        const portMatch = namePart.match(/:(\d+)/);
        if (portMatch && portMatch[1]) {
          const port = parseInt(portMatch[1], 10);
          const pid = parseInt(pidStr, 10);
          
          if (!isNaN(port) && !isNaN(pid) && !uniquePorts.has(port)) {
            uniquePorts.add(port);
            processes.push({ port, pid, process: command });
          }
        }
      }
    }
    await enrichWithUnixMemory(processes);
    await enrichWithCommandLines(processes);
    return processes.sort((a, b) => a.port - b.port);
  } catch (error) {
    // If lsof fails (e.g., not installed on Linux)
    if (process.platform === 'linux') {
      return getLinuxSSPorts();
    }
    return [];
  }
}

async function getLinuxSSPorts(): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await execAsync('ss -tulpn');
    const lines = stdout.split('\n');
    const processes: ProcessInfo[] = [];
    const uniquePorts = new Set<number>();
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      if (line.includes('LISTEN')) {
        const parts = line.split(/\s+/);
        // format: Netid State Recv-Q Send-Q LocalAddress:Port PeerAddress:PortProcess
        const localAddrMatch = parts[4]?.match(/:(\d+)$/);
        const processMatch = line.match(/users:\(\("([^"]+)"[^\)]+pid=(\d+)/);
        
        if (localAddrMatch && localAddrMatch[1]) {
          const port = parseInt(localAddrMatch[1], 10);
          
          if (!uniquePorts.has(port)) {
            uniquePorts.add(port);
            
            let procName = 'Unknown';
            let pid = -1;
            
            if (processMatch) {
              procName = processMatch[1];
              pid = parseInt(processMatch[2], 10);
            }
            
            processes.push({ port, pid, process: procName });
          }
        }
      }
    }
    await enrichWithUnixMemory(processes);
    await enrichWithCommandLines(processes);
    return processes.sort((a, b) => a.port - b.port);
  } catch (error) {
    return [];
  }
}

async function enrichWithUnixMemory(processes: ProcessInfo[]) {
  if (processes.length === 0) return;
  try {
    const { stdout } = await execAsync('ps -e -o pid,rss');
    const lines = stdout.split('\n');
    const memMap = new Map<number, number>();
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 2) {
        const pid = parseInt(parts[0], 10);
        const rss = parseInt(parts[1], 10);
        if (!isNaN(pid) && !isNaN(rss)) {
          memMap.set(pid, Math.round(rss / 1024));
        }
      }
    }
    for (const p of processes) {
      if (memMap.has(p.pid)) {
        p.memory = memMap.get(p.pid);
      }
    }
  } catch (err) {
    // Ignore if ps fails
  }
}

async function enrichWithCommandLines(processes: ProcessInfo[]) {
  if (processes.length === 0) return;
  const pids = processes.map(p => p.pid);
  
  let map = new Map<number, string>();
  if (process.platform === 'win32') {
    try {
      // PowerShell is reliable on modern Windows; wmic is deprecated
      const psCmd = `powershell -NoProfile -Command "Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,Path,CommandLine | ConvertTo-Json -Compress"`;
      const { stdout } = await execAsync(psCmd, { maxBuffer: 10 * 1024 * 1024 });
      const trimmed = stdout.trim();
      if (trimmed) {
        const parsed = JSON.parse(trimmed);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item.Id && (item.CommandLine || item.Path)) {
            map.set(item.Id, item.CommandLine || item.Path || '');
          }
        }
      }
    } catch {}
  } else {
    try {
      const { stdout } = await execAsync('ps -o pid= -o command= -p ' + pids.join(','));
      const lines = stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx > 0) {
          const pid = parseInt(trimmed.substring(0, spaceIdx), 10);
          const cmdLine = trimmed.substring(spaceIdx + 1).trim();
          if (!isNaN(pid)) {
            map.set(pid, cmdLine);
          }
        }
      }
    } catch {}
  }

  for (const p of processes) {
    const cmdLine = map.get(p.pid);
    p.cmdLine = cmdLine || '';
    p.project = extractProjectName(cmdLine || '', p.process);
  }
}

function extractProjectName(cmdLine: string, fallbackName: string): string {
  if (!cmdLine) return fallbackName;
  
  const pathRegex = /(?:[a-zA-Z]:[\\/]|[/])[^\s"']+/g;
  const matches = cmdLine.match(pathRegex) || [];
  
  const ignoreDirs = new Set(['node_modules', 'bin', 'src', 'dist', 'build', 'public', 'system32', 'program files', 'nodejs', 'usr', 'opt', 'var', 'lib', 'windows']);
  
  for (let match of matches.reverse()) {
    let p = match.replace(/\\/g, '/');
    const segments = p.split('/').filter(Boolean);
    
    for (let i = segments.length - 2; i >= 0; i--) {
      const dir = segments[i];
      if (dir && !ignoreDirs.has(dir.toLowerCase()) && !dir.includes('.')) {
        return dir;
      }
    }
  }
  return fallbackName;
}

const SYSTEM_PROCESSES = new Set([
  'system', 'idle', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'winlogon.exe',
  'launchd', 'init', 'systemd', 'kernel_task',
]);

export function isSystemProcess(p: ProcessInfo): boolean {
  if (p.pid <= 4) return true;
  return SYSTEM_PROCESSES.has(p.process.toLowerCase());
}

const SENSITIVE_PATTERNS = /(--(token|key|secret|password|api[_-]?key)=)\S+/gi;

export function redactCmdLine(cmdLine: string): string {
  return cmdLine.replace(SENSITIVE_PATTERNS, '$1[REDACTED]');
}
