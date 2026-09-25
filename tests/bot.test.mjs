import assert from "node:assert/strict";
import test from "node:test";

import { BOT_COMMANDS, helpMessage, registerCommands } from "../dist/bot.js";
import { escapeMd } from "../dist/notifications/format.js";

test("helpMessage generates exact MarkdownV2 payload from registered commands", () => {
  const message = helpMessage();
  assert.match(message, /\*Mimir notifier\*/);
  
  // Snapshot the exact payload
  const lines = [
    "*Mimir notifier*",
    "",
    "I watch Mimir's two Soroban contracts on Stellar and post every new on-chain event here: claims opened, challenges staked, oracle resolutions, settlements and payouts\\.",
    "",
  ];
  for (const cmd of BOT_COMMANDS) {
    if (cmd.command === "start") continue;
    lines.push(`/${cmd.command} — ${escapeMd(cmd.description)}`);
  }
  const expected = lines.join("\n");
  
  assert.equal(message, expected);
});

test("registerCommands sends the exact BOT_COMMANDS to Telegram", async () => {
  const sent = [];
  const fakeBot = {
    api: {
      setMyCommands: async (commands) => {
        sent.push(commands);
      }
    }
  };
  await registerCommands(fakeBot);
  assert.deepEqual(sent, [BOT_COMMANDS]);
});

test("registerCommands handles Telegram failures gracefully", async () => {
  const fakeBot = {
    api: {
      setMyCommands: async () => {
        throw new Error("Telegram is down");
      }
    }
  };
  
  // Should not throw, just log warning
  await assert.doesNotReject(registerCommands(fakeBot));
});
