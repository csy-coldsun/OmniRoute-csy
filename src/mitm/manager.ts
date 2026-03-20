import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { resolveDataDir } from "@/lib/dataPaths";
import { addDNSEntry, removeDNSEntry } from "./dns/dnsConfig";
import { generateCert } from "./cert/generate";
import { installCert } from "./cert/install";

// Store server process
let serverProcess = null;
let serverPid = null;

// Module-scoped password cache (not exposed on globalThis).
// Cleared automatically when the MITM proxy is stopped.
let _cachedPassword = null;
export function getCachedPassword() {
  return _cachedPassword;
}
export function setCachedPassword(pwd) {
  _cachedPassword = pwd || null;
}
export function clearCachedPassword() {
  _cachedPassword = null;
}

const PID_FILE = path.join(resolveDataDir(), "mitm", ".mitm.pid");

// FIX: Use process.cwd() which always points to project root at runtime
const MITM_SERVER_PATH = path.join(process.cwd(), "src", "mitm", "server.cjs");

// Check if a PID is alive
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get MITM status
 */
export async function getMitmStatus() {
  // Check in-memory process first, then fallback to PID file
  let running = serverProcess !== null && !serverProcess.killed;
  let pid = serverPid;

  if (!running) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          running = true;
          pid = savedPid;
        } else {
          // Stale PID file, clean up
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch {
      // Ignore
    }
  }

  // Check DNS configuration
  let dnsConfigured = false;
  try {
    const hostsContent = fs.readFileSync("/etc/hosts", "utf-8");
    dnsConfigured = hostsContent.includes("daily-cloudcode-pa.googleapis.com");
  } catch {
    // Ignore
  }

  // Check cert
  const certDir = path.join(resolveDataDir(), "mitm");
  const certExists = fs.existsSync(path.join(certDir, "server.crt"));

  return { running, pid, dnsConfigured, certExists };
}

/**
 * Start MITM proxy
 * @param {string} apiKey - OmniRoute API key
 * @param {string} sudoPassword - Sudo password for DNS/cert operations
 */
export async function startMitm(apiKey, sudoPassword) {
  // Check if already running
  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM proxy is already running");
  }

  // 1. Generate SSL certificate if not exists
  const certPath = path.join(resolveDataDir(), "mitm", "server.crt");
  if (!fs.existsSync(certPath)) {
    console.log("Generating SSL certificate...");
    await generateCert();
  }

  // 2. Install certificate to system keychain
  try {
    await installCert(sudoPassword, certPath);
  } catch (certErr) {
    throw new Error(`Certificate installation failed: ${certErr.message}`);
  }

  // 3. Add DNS entry
  try {
    await addDNSEntry(sudoPassword);
  } catch (dnsErr) {
    throw new Error(`DNS configuration failed: ${dnsErr.message}`);
  }

  // 4. Start MITM server
  console.log("[MITM Manager] Starting MITM server process...");
  try {
    // Windows: Add --use-system-ca for better certificate handling
    const nodeArgs = [];
    if (process.platform === "win32") {
      nodeArgs.push("--use-system-ca");
      console.log("[MITM Manager] Using system CA certificates (Windows)");
    }

    serverProcess = spawn(process.execPath, [...nodeArgs, MITM_SERVER_PATH], {
      env: {
        ...process.env, // 确保继承所有环境变量
        ROUTER_API_KEY: apiKey,
        NODE_ENV: "production",
      },
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (spawnErr) {
    console.error("[MITM Manager] Spawn failed:", spawnErr);
    throw new Error(`Failed to spawn MITM process: ${spawnErr.message}`);
  }

  serverPid = serverProcess.pid;
  console.log("[MITM Manager] Server PID:", serverPid);

  // Log MITM server output for debugging
  serverProcess.stdout?.on("data", (data) => {
    const msg = data.toString().trim();
    console.log(`[MITM Server] ${msg}`);

    // Also write to application log
    try {
      const logFile = path.join(resolveDataDir(), "logs", "mitm-server.log");
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  });

  serverProcess.stderr?.on("data", (data) => {
    const msg = data.toString().trim();
    console.error(`[MITM Server Error] ${msg}`);

    // Also write to application log
    try {
      const logFile = path.join(resolveDataDir(), "logs", "mitm-error.log");
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ERROR: ${msg}\n`);
    } catch {}
  });

  serverProcess.on("exit", (code) => {
    console.log(`[MITM Manager] MITM server exited with code ${code}`);
    serverProcess = null;
    serverPid = null;

    // Remove PID file
    try {
      fs.unlinkSync(PID_FILE);
    } catch (error) {
      // Ignore
    }
  });

  // Wait and verify server actually started
  const started = await new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    }, 2000);

    serverProcess.on("exit", (code) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    // Check stderr for error messages
    serverProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg.includes("Port") && msg.includes("already in use")) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
      if (msg.includes("Permission denied")) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
    });
  });

  if (!started) {
    throw new Error("MITM server failed to start (port 443 may be in use or permission denied)");
  }

  console.log("[MITM Manager] MITM started successfully");
  return {
    running: true,
    pid: serverPid,
  };
}

/**
 * Stop MITM proxy
 * @param {string} sudoPassword - Sudo password for DNS cleanup
 */
export async function stopMitm(sudoPassword) {
  // 1. Kill server process (in-memory or from PID file)
  const proc = serverProcess;
  if (proc && !proc.killed) {
    console.log("Stopping MITM server...");
    proc.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!proc.killed) {
      proc.kill("SIGKILL");
    }
    serverProcess = null;
    serverPid = null;
  } else {
    // Fallback: kill by PID file
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          console.log(`Killing MITM server (PID: ${savedPid})...`);
          process.kill(savedPid, "SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (isProcessAlive(savedPid)) {
            process.kill(savedPid, "SIGKILL");
          }
        }
      }
    } catch {
      // Ignore
    }
    serverProcess = null;
    serverPid = null;
  }

  // 2. Remove DNS entry
  console.log("Removing DNS entry...");
  await removeDNSEntry(sudoPassword);

  // 3. Clean up
  clearCachedPassword(); // Clear password from memory when proxy stops
  try {
    fs.unlinkSync(PID_FILE);
  } catch (error) {
    // Ignore
  }

  return {
    running: false,
    pid: null,
  };
}
