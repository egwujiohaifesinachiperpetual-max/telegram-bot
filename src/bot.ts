/**
 * The grammy bot: commands, and the one send path the poller uses.
 *
 * The bot half is deliberately thin. It answers four commands and exposes
 * `notify()`; all chain logic lives in `src/poller.ts` and `src/stellar/`.
 */

import { Bot } from "grammy";

import { escapeMd } from "./notifications/format.js";
import { networkLabel, type BotConfig } from "./config.js";
import type { PollerStatus } from "./poller.js";
import { buildHealthReport } from "./health.js";

const HELP = [
  "*Mimir notifier*",
  "",
  "I watch Mimir's two Soroban contracts on Stellar and post every new on-chain event here: claims opened, challenges staked, oracle resolutions, settlements and payouts\\.",
  "",
  "/status — what I am watching and how far I have read",
  "/health — health assessment and operational readiness",
  "/help — this message",
].join("\n");

function ago(timestamp: number | null, nowMs: number = Date.now()): string {
  if (timestamp === null) return "never";
  const seconds = Math.max(0, Math.round((nowMs - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function statusMessage(config: BotConfig, status: PollerStatus, nowMs: number = Date.now()): string {
  const lines: string[] = [
    `*Status* — ${status.running ? "running" : "stopped"} on Stellar ${networkLabel(config)}`,
    "",
    `Chain tip: ${status.latestLedger ?? "unknown"}`,
    `RPC retains from ledger: ${status.oldestLedger ?? "unknown"}`,
    `Poll interval: ${Math.round(config.pollIntervalMs / 1000)}s · last poll ${ago(status.lastPollAt, nowMs)}`,
    `Cycles: ${status.cycles} · sent ${status.notificationsSent} · failed sends ${status.notificationsFailed} · skipped ${status.eventsSkipped}`,
    "",
    "*Watching*",
  ];

  for (const target of status.targets) {
    lines.push(
      `· mimir\\-${target.source} \`${target.contractId}\``,
      `  last event ledger: ${target.lastEventLedger ?? "none seen"}`,
      `  cursor: \`${target.cursor ?? "none (cold start)"}\``,
    );
    if (target.lastError) lines.push(`  last error: ${escapeMd(target.lastError)}`);
  }

  if (status.lastError) {
    lines.push(
      "",
      `Last error \\(${ago(status.lastError.at, nowMs)}\\): ${escapeMd(status.lastError.message)}`,
    );
  }
  if (status.consecutiveFailures > 0) {
    lines.push(`Consecutive failed cycles: ${status.consecutiveFailures}`);
  }

  return lines.join("\n");
}

export function healthMessage(
  config: BotConfig,
  status: PollerStatus,
  nowMs: number = Date.now(),
): string {
  const report = buildHealthReport(config, status, nowMs);
  const statusLabel = report.status.toUpperCase();

  const lines: string[] = [
    `*Health* — ${escapeMd(statusLabel)} on Stellar ${networkLabel(config)}`,
    "",
    `Status: \`${report.status}\` \\(${report.ok ? "ok" : "action required"}\\)`,
    `Poller: ${report.poller.running ? "running" : "stopped"}`,
    `Uptime: ${report.uptimeMs > 0 ? ago(nowMs - report.uptimeMs, nowMs) : "0s"}`,
    `Poll interval: ${Math.round(config.pollIntervalMs / 1000)}s · last poll ${ago(status.lastPollAt, nowMs)}`,
    `Last successful poll: ${ago(status.lastSuccessAt, nowMs)}`,
    `Chain tip: ${report.poller.latestLedger ?? "unknown"}`,
    `Cycles: ${report.poller.cycles} · consecutive failures: ${report.poller.consecutiveFailures}`,
    `Notifications: sent ${report.poller.notificationsSent} · failed ${report.poller.notificationsFailed} · skipped ${report.poller.eventsSkipped}`,
    "",
    "*Watched Contracts*",
  ];

  for (const target of report.poller.targets) {
    lines.push(
      `· mimir\\-${target.source} \`${target.contractId}\``,
      `  last event ledger: ${target.lastEventLedger ?? "none seen"}`,
      `  cursor: \`${target.cursorPreview ?? "none (cold start)"}\``,
    );
    if (target.hasError) {
      const targetState = status.targets.find((t) => t.source === target.source);
      if (targetState?.lastError) {
        lines.push(`  last error: ${escapeMd(targetState.lastError)}`);
      }
    }
  }

  if (report.poller.lastError) {
    lines.push(
      "",
      `Last error \\(${ago(status.lastError?.at ?? null, nowMs)}\\): ${escapeMd(report.poller.lastError.message)}`,
    );
  }

  return lines.join("\n");
}

export interface BotDeps {
  config: BotConfig;
  status: () => PollerStatus;
}

export function createBot(deps: BotDeps): Bot {
  const { config, status } = deps;
  const bot = new Bot(config.botToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(HELP, { parse_mode: "MarkdownV2" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP, { parse_mode: "MarkdownV2" });
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(statusMessage(config, status()), {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("health", async (ctx) => {
    await ctx.reply(healthMessage(config, status()), {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    });
  });

  // grammy rethrows handler errors by default, which would take the process
  // with it. A malformed command must not be fatal.
  bot.catch((err) => {
    console.error(`[bot] handler error on update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}

/** The poller's send path: one message to the configured chat. */
export function createNotifier(bot: Bot, config: BotConfig) {
  return async (text: string): Promise<void> => {
    await bot.api.sendMessage(config.chatId, text, {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    });
  };
}

/** Registers the command list so Telegram's UI offers autocompletion. */
export async function registerCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "What this bot does" },
      { command: "help", description: "Show help" },
      { command: "status", description: "Last-seen ledger and watched contracts" },
      { command: "health", description: "Health assessment and operational readiness" },
    ]);
  } catch (err) {
    // Cosmetic. Never worth failing a boot over.
    console.warn(`[bot] setMyCommands failed: ${err instanceof Error ? err.message : err}`);
  }
}

