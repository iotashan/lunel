import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

// On macOS the Tailscale.app GUI build ships its CLI inside the bundle rather
// than on PATH. Check PATH first (CLI / Homebrew installs), then the bundle.
const MAC_APP_BUNDLE_PATH = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export interface TailscaleStatus {
  /** Resolved tailscale binary path (PATH name or app-bundle path). */
  binary: string;
  /** MagicDNS FQDN with the trailing dot stripped (may be "" if MagicDNS off). */
  fqdn: string;
  /** Self.TailscaleIPs — typically one 100.64.0.0/10 v4 and one fd7a: v6. */
  ips: string[];
}

export class TailscaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailscaleError";
  }
}

async function runStatusJson(bin: string): Promise<string> {
  const { stdout } = await execFileAsync(bin, ["status", "--json"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "ENOENT";
}

/**
 * Detect a running Tailscale and read this machine's MagicDNS name + IPs.
 * Throws TailscaleError with an actionable message if Tailscale is missing or
 * not running. Field names verified against tailscale ~1.9x+ status --json:
 * `BackendState`, `Self.DNSName`, `Self.TailscaleIPs`.
 */
export async function detectTailscale(): Promise<TailscaleStatus> {
  let bin = "tailscale";
  let raw: string;
  try {
    raw = await runStatusJson(bin);
  } catch (err) {
    if (isEnoent(err)) {
      if (!existsSync(MAC_APP_BUNDLE_PATH)) {
        throw new TailscaleError(
          "Tailscale not found. Install it (https://tailscale.com/download) and start/sign in, then retry.",
        );
      }
      bin = MAC_APP_BUNDLE_PATH;
      try {
        raw = await runStatusJson(bin);
      } catch (err2) {
        throw new TailscaleError(
          `Failed to run Tailscale at ${bin}: ${err2 instanceof Error ? err2.message : String(err2)}`,
        );
      }
    } else {
      throw new TailscaleError(
        `Failed to run \`tailscale status --json\`: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let status: { BackendState?: string; Self?: { DNSName?: string; TailscaleIPs?: string[] } };
  try {
    status = JSON.parse(raw);
  } catch {
    throw new TailscaleError("Could not parse `tailscale status --json` output.");
  }

  if (status.BackendState !== "Running") {
    throw new TailscaleError(
      `Tailscale is installed but not running (BackendState=${status.BackendState ?? "unknown"}). ` +
        "Start Tailscale and sign in, then retry.",
    );
  }

  const self = status.Self ?? {};
  const fqdn = (self.DNSName ?? "").replace(/\.$/, "");
  const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
  if (!fqdn && ips.length === 0) {
    throw new TailscaleError(
      "Tailscale is running but exposes no MagicDNS name or IP. Enable MagicDNS in the admin console.",
    );
  }

  return { binary: bin, fqdn, ips };
}
