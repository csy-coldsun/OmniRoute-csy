// Node.js-only route: uses child_process, fs, path via mitm/manager
// Dynamic imports prevent Turbopack from statically resolving native modules
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cliMitmStartSchema, cliMitmStopSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

// Simple dynamic import - but verify it's not the stub
async function loadManager() {
  console.log("[MITM API] Loading manager module...");
  const manager = await import("@/mitm/manager");
  console.log("[MITM API] Loaded exports:", Object.keys(manager));

  // Check if startMitm is the stub version
  const startMitmStr = manager.startMitm?.toString?.() || "";
  console.log("[MITM API] startMitm source:", startMitmStr.substring(0, 100) + "...");

  // Stub function looks like: async (_apiKey, _sudoPassword) => ({ running: false, pid: null })
  // Real function has console.log statements
  const isStub = startMitmStr.includes("running: false") && !startMitmStr.includes("console.log");

  if (isStub) {
    console.error("[MITM API] Detected stub! startMitm source:", startMitmStr);
    throw new Error("Loaded stub module. This is a Turbopack issue.");
  }

  return manager;
}

// GET - Check MITM status
export async function GET() {
  try {
    const manager = await loadManager();
    const { getMitmStatus, getCachedPassword } = manager;

    if (typeof getMitmStatus !== "function") {
      throw new Error("getMitmStatus is not a function");
    }

    const status = await getMitmStatus();
    return NextResponse.json({
      running: status.running,
      pid: status.pid || null,
      dnsConfigured: status.dnsConfigured || false,
      certExists: status.certExists || false,
      hasCachedPassword: !!getCachedPassword(),
    });
  } catch (error) {
    console.log("Error getting MITM status:", error.message);
    return NextResponse.json({ error: "Failed to get MITM status" }, { status: 500 });
  }
}

// POST - Start MITM proxy
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    console.log("POST /api/cli-mitm");
    const validation = validateBody(cliMitmStartSchema, rawBody);
    if (isValidationFailure(validation)) {
      console.log("[MITM API] Validation failed:", validation.error);
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { apiKey, sudoPassword } = validation.data;
    console.log("[MITM API] Validation passed:", {
      apiKey: apiKey?.substring(0, 8) + "...",
      hasSudoPassword: !!sudoPassword,
    });

    // Load manager and verify it's not the stub
    const manager = await loadManager();
    const { startMitm, getCachedPassword, setCachedPassword } = manager;

    console.log("[MITM API] startMitm type:", typeof startMitm);

    if (typeof startMitm !== "function") {
      throw new Error("startMitm is not a function");
    }

    const isWin = process.platform === "win32";
    const pwd = sudoPassword || getCachedPassword() || "";

    console.log("[MITM API] Platform check:", {
      isWin,
      platform: process.platform,
      hasPwd: !!pwd,
      hasCachedPwd: !!getCachedPassword(),
    });

    if (!apiKey || (!isWin && !pwd)) {
      console.log("[MITM API] Validation failed:", {
        missingApiKey: !apiKey,
        missingPassword: !isWin && !pwd,
      });
      return NextResponse.json(
        { error: isWin ? "Missing apiKey" : "Missing apiKey or sudoPassword" },
        { status: 400 }
      );
    }

    console.log("[MITM API] Calling startMitm...");
    console.log("[MITM API] Arguments:", {
      apiKey: apiKey.substring(0, 8) + "...",
      hasPwd: !!pwd,
      isWin,
    });

    try {
      const result = await startMitm(apiKey, pwd);
      console.log("[MITM API] Result:", result);

      if (!isWin) setCachedPassword(pwd);

      return NextResponse.json({
        success: true,
        running: result.running,
        pid: result.pid,
      });
    } catch (startErr) {
      console.error("[MITM API] startMitm error:", startErr);
      console.error("[MITM API] Stack:", startErr.stack);
      throw startErr;
    }
  } catch (error) {
    console.error("[MITM API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to start MITM proxy" },
      { status: 500 }
    );
  }
}

// DELETE - Stop MITM proxy
export async function DELETE(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    const validation = validateBody(cliMitmStopSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { sudoPassword } = validation.data;
    const { stopMitm, getCachedPassword, setCachedPassword } = await import("@/mitm/manager");
    const isWin = process.platform === "win32";
    const pwd = sudoPassword || getCachedPassword() || "";

    if (!isWin && !pwd) {
      return NextResponse.json({ error: "Missing sudoPassword" }, { status: 400 });
    }

    await stopMitm(pwd);
    if (!isWin && sudoPassword) setCachedPassword(sudoPassword);

    return NextResponse.json({ success: true, running: false });
  } catch (error) {
    console.log("Error stopping MITM:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to stop MITM proxy" },
      { status: 500 }
    );
  }
}
