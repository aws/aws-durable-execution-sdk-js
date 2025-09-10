import * as fs from "fs";
import { execSync } from "child_process";

/**
 * Bundle size tracking script that monitors bundle size changes over time
 * Maintains a history of bundle sizes with timestamps and git commits
 */

interface BundleSizeEntry {
  timestamp: string;
  size: number;
  gitCommit?: string;
}

type BundleSizeHistory = BundleSizeEntry[];

const BUNDLE_FILE = "./dist/index.js";
const HISTORY_FILE = "./bundle-size-history.json";

function getCurrentGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function loadHistory(): BundleSizeHistory {
  if (!fs.existsSync(HISTORY_FILE)) {
    return [];
  }

  try {
    const content = fs.readFileSync(HISTORY_FILE, "utf8");
    return JSON.parse(content) as BundleSizeHistory;
  } catch (error) {
    console.warn(
      `⚠️  Could not read history file: ${(error as Error).message}`,
    );
    return [];
  }
}

function saveHistory(history: BundleSizeHistory): void {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error(`❌ Could not save history: ${(error as Error).message}`);
  }
}

function getCurrentBundleSize(): number {
  if (!fs.existsSync(BUNDLE_FILE)) {
    throw new Error(
      `Bundle file not found: ${BUNDLE_FILE}. Please run a build first.`,
    );
  }

  const stats = fs.statSync(BUNDLE_FILE);
  return stats.size;
}

function findPreviousDifferentSize(
  history: BundleSizeHistory,
  currentSize: number,
): BundleSizeEntry | null {
  // Find the most recent entry with a different size
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].size !== currentSize) {
      return history[i];
    }
  }
  return null;
}

function calculateSizeChange(
  currentSize: number,
  previousSize: number,
): {
  change: number;
  percentage: number;
  direction: "increased" | "decreased" | "unchanged";
} {
  const change = currentSize - previousSize;
  const percentage = (change / previousSize) * 100;

  let direction: "increased" | "decreased" | "unchanged";
  if (change > 0) {
    direction = "increased";
  } else if (change < 0) {
    direction = "decreased";
  } else {
    direction = "unchanged";
  }

  return { change, percentage, direction };
}

function trackBundleSize(): void {
  try {
    console.log("\n📊 Bundle Size Tracking");
    console.log("=======================");

    // Get current bundle size
    const currentSize = getCurrentBundleSize();
    console.log(`Current size: ${formatBytes(currentSize)}`);

    // Load existing history
    const history = loadHistory();

    // Check if this size already exists (avoid duplicate entries)
    const lastEntry = history[history.length - 1];
    if (lastEntry && lastEntry.size === currentSize) {
      console.log("📝 Size unchanged since last measurement");
      return;
    }

    // Find previous different size for comparison
    const previousDifferent = findPreviousDifferentSize(history, currentSize);

    if (previousDifferent) {
      const previousDate = new Date(
        previousDifferent.timestamp,
      ).toLocaleDateString();
      console.log(
        `Previous different size: ${formatBytes(previousDifferent.size)} (${previousDate})`,
      );

      const { change, percentage, direction } = calculateSizeChange(
        currentSize,
        previousDifferent.size,
      );

      const changeStr =
        Math.abs(change) < 1024
          ? `${Math.abs(change)} bytes`
          : formatBytes(Math.abs(change));

      const emoji = direction === "increased" ? "📈" : "📉";
      const verb = direction === "increased" ? "increased" : "decreased";

      console.log(
        `${emoji} Size ${verb} by ${changeStr} (${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%)`,
      );
    } else {
      console.log("📝 First size measurement recorded");
    }

    // Create current measurement entry
    const timestamp = new Date().toISOString();
    const entry: BundleSizeEntry = {
      timestamp,
      size: currentSize,
      gitCommit: getCurrentGitCommit(),
    };

    // Add to history
    history.push(entry);

    // Keep only last 50 entries to prevent file from growing too large
    const trimmedHistory = history.slice(-50);

    // Save updated history
    saveHistory(trimmedHistory);

    // Show recent trend (last 10 builds)
    const recent = trimmedHistory.slice(-10);
    if (recent.length > 1) {
      console.log("\n📈 Recent Size Trend (Last 10 builds):");
      console.log("=====================================");
      recent.forEach((entry, index) => {
        const date = new Date(entry.timestamp).toLocaleDateString();
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const commit = entry.gitCommit
          ? ` (${entry.gitCommit.slice(0, 7)})`
          : "";
        console.log(
          `${(index + 1).toString().padStart(2)}. ${date} ${time} - ${formatBytes(entry.size)}${commit}`,
        );
      });
    }
  } catch (error) {
    console.error("❌ Bundle size tracking failed:", (error as Error).message);
    process.exit(1);
  }
}

// Run tracking if this script is executed directly
if (require.main === module) {
  trackBundleSize();
}

export { trackBundleSize, formatBytes, loadHistory, saveHistory };
