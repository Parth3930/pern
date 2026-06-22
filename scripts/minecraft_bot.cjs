const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");

const port = parseInt(process.argv[2]) || 25565;
const host = process.argv[3] || "localhost";
const username = process.argv[4] || "Pern";
const version = process.argv[5] || "1.20.4";

console.log(
  `Connecting to Minecraft world at ${host}:${port} as ${username} (Version: ${version})...`,
);

const bot = mineflayer.createBot({
  host: host,
  port: port,
  username: username,
  auth: "offline",
  version: version,
});

// Load the A* pathfinder plugin
bot.loadPlugin(pathfinder);

let followTarget = null;
let isBusy = false;

async function getAIResponse(sender, message) {
  try {
    const res = await fetch("http://127.0.0.1:4891/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "local",
        messages: [
          {
            role: "system",
            content:
              "You are Pern, a helpful AI assistant playing Minecraft with the user. Keep your responses short (under 2 sentences) so they fit in Minecraft chat.",
          },
          { role: "user", content: `<${sender}> ${message}` },
        ],
        stream: false,
      }),
    });
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    console.error("AI Request failed:", err);
    return "Sorry, my local AI brain is unreachable right now.";
  }
}

const digBlock = (block) =>
  new Promise((resolve, reject) => {
    bot.dig(block, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

async function tossHarvestedLogs() {
  const items = bot.inventory
    .items()
    .filter(
      (item) =>
        item.name.includes("log") ||
        item.name.includes("wood") ||
        item.name.includes("stem"),
    );

  if (items.length === 0) {
    bot.chat("I don't have any wood to give you!");
    return;
  }

  bot.chat("Here is the wood!");
  for (const item of items) {
    try {
      await bot.tossStack(item);
      await new Promise((r) => setTimeout(r, 250)); // Tiny pause between tosses
    } catch (e) {
      console.error("Failed to toss stack:", e);
    }
  }
}

async function fetchWood(sender, requestedCount) {
  if (isBusy) {
    bot.chat("I'm currently busy!");
    return;
  }
  isBusy = true;
  followTarget = null; // Pause following while harvesting

  const player = bot.players[sender];
  if (!player || !player.entity) {
    bot.chat("I need to see you to know where to bring the wood!");
    isBusy = false;
    return;
  }

  const targetCount = requestedCount || 16;
  bot.chat(`I'll fetch up to ${targetCount} wood blocks for you!`);

  let harvested = 0;
  const defaultMove = new Movements(bot);
  defaultMove.canDig = true;

  // ponytail: enable scaffolding to climb up trees / reach high blocks
  const mcData = require("minecraft-data")(bot.version);
  const scaffoldBlockNames = [
    "dirt",
    "cobblestone",
    "stone",
    "oak_planks",
    "spruce_planks",
    "birch_planks",
    "jungle_planks",
    "acacia_planks",
    "dark_oak_planks",
    "mangrove_planks",
    "cherry_planks",
    "bamboo_planks",
    "oak_log",
    "spruce_log",
    "birch_log",
    "jungle_log",
    "acacia_log",
    "dark_oak_log",
    "mangrove_log",
    "cherry_log",
    "oak_wood",
    "spruce_wood",
    "birch_wood",
    "jungle_wood",
    "acacia_wood",
    "dark_oak_wood",
    "mangrove_wood",
    "cherry_wood",
  ];
  const scaffoldIds = scaffoldBlockNames
    .map((name) => mcData.itemsByName[name]?.id)
    .filter((id) => id !== undefined);
  defaultMove.scafoldingBlocks = scaffoldIds;
  defaultMove.scaffoldBlocks = scaffoldIds;
  defaultMove.canPlaceBlocks = true;

  bot.pathfinder.setMovements(defaultMove);

  // Keep track of blocks we failed to reach so we don't scan them again
  const unreachableBlocks = [];

  let nextWoodBlock = null;

  while (harvested < targetCount) {
    // ponytail: use pre-fetched block if available, otherwise find the closest one
    const woodBlock =
      nextWoodBlock ||
      bot.findBlock({
        matching: (block) => {
          const isWood =
            block.name.includes("log") ||
            block.name.includes("wood") ||
            block.name.includes("stem");
          if (!isWood) return false;
          // Skip if we marked this block as unreachable
          const isUnreachable = unreachableBlocks.some(
            (pos) => pos && block.position && pos.equals(block.position),
          );
          return !isUnreachable;
        },
        maxDistance: 32,
      });

    nextWoodBlock = null; // Reset for next loop

    if (!woodBlock) {
      if (harvested > 0) {
        bot.chat(
          `No more reachable wood nearby. Returning with ${harvested} wood.`,
        );
      } else {
        bot.chat("I couldn't find any reachable wood blocks within 32 blocks.");
      }
      break;
    }

    try {
      // Stand next to block
      await bot.pathfinder.goto(
        new goals.GoalLookAtBlock(woodBlock.position, bot.world, 4),
      );

      // ponytail: re-verify block exists before digging to prevent hanging on cached air
      const currentBlock = bot.blockAt(woodBlock.position);
      if (
        !currentBlock ||
        currentBlock.type === 0 ||
        !bot.canDigBlock(currentBlock)
      ) {
        unreachableBlocks.push(woodBlock.position);
        continue;
      }

      // Mine
      await bot.lookAt(woodBlock.position);
      // ponytail: promise-based dig with safety timeout to prevent hanging forever
      await Promise.race([
        digBlock(currentBlock),
        new Promise((_, reject) =>
          setTimeout(() => {
            bot.stopDigging();
            reject(new Error("digging timeout"));
          }, 8000),
        ),
      ]);

      // ponytail: find the next block in parallel so there's no path planning wait time
      const nextBlockPromise = Promise.resolve()
        .then(() => {
          return bot.findBlock({
            matching: (block) => {
              const isWood =
                block.name.includes("log") ||
                block.name.includes("wood") ||
                block.name.includes("stem");
              if (!isWood) return false;
              if (block.position.equals(woodBlock.position)) return false; // skip current
              const isUnreachable = unreachableBlocks.some(
                (pos) => pos && block.position && pos.equals(block.position),
              );
              return !isUnreachable;
            },
            maxDistance: 32,
          });
        })
        .catch(() => null);

      harvested++;
      nextWoodBlock = await nextBlockPromise;
    } catch (err) {
      console.warn(
        `Unreachable block at ${woodBlock.position}: ${err.message || err}`,
      );
      unreachableBlocks.push(woodBlock.position); // Ignore this block in future loops
    }
  }

  // Return and toss items
  if (harvested > 0) {
    bot.chat("Returning to you...");
    try {
      // ponytail: use GoalNear instead of GoalFollow to avoid hanging when player moves
      await bot.pathfinder.goto(new goals.GoalNear(player.entity.position, 3));
      await bot.lookAt(
        player.entity.position.offset(0, player.entity.height, 0),
      );
      await tossHarvestedLogs();
    } catch (err) {
      bot.chat("I got lost, dropping the wood here!");
      await tossHarvestedLogs();
    }
  }
  isBusy = false;
}

bot.on("spawn", () => {
  console.log(`Bot spawned successfully!`);
  bot.chat("Hello! I am Pern, your AI assistant. I have joined the world!");

  // Set up movements
  const defaultMove = new Movements(bot);
  bot.pathfinder.setMovements(defaultMove);
});

// Look at the target player on every physics tick
bot.on("physicTick", () => {
  if (followTarget && !isBusy) {
    bot.lookAt(followTarget.position.offset(0, followTarget.height, 0));
  }
});

bot.on("chat", async (sender, message) => {
  if (sender === bot.username) return;
  console.log(`[CHAT] <${sender}> ${message}`);

  const msgLower = message.toLowerCase();

  // Smart regex trigger for gathering/mining wood
  const harvestRegex =
    /\b(get|fetch|mine|gather|collect|chop|harvest)\b.*\b(wood|log|tree|oak|spruce|birch|jungle|acacia)\b/i;
  if (harvestRegex.test(msgLower)) {
    const numMatch = msgLower.match(/\b(\d+)\b/);
    const count = numMatch ? parseInt(numMatch[1], 10) : 16;
    await fetchWood(sender, count);
    return;
  }

  // Handle direct follow / stop command overrides
  if (
    msgLower.includes("follow me") ||
    msgLower.includes("come here") ||
    msgLower.includes("follow")
  ) {
    const player = bot.players[sender];
    if (!player || !player.entity) {
      bot.chat("I can't see you to follow!");
      return;
    }
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    // Track target
    followTarget = player.entity;
    bot.chat("Okay, following you now!");
    // ponytail: set goal once here. setting it in physicTick cancels/recalculates path continuously, causing bot to stand still
    bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 4), true);
    return;
  }

  if (msgLower.includes("stop") || msgLower.includes("stay")) {
    bot.pathfinder.setGoal(null);
    followTarget = null;
    bot.chat("Stopping here.");
    return;
  }

  // Otherwise, get AI response
  const reply = await getAIResponse(sender, message);
  bot.chat(reply);
});

bot.on("kicked", (reason) => {
  console.error(`Kicked from server: ${reason}`);
  process.exit(1);
});

bot.on("error", (err) => {
  console.error("Error occurred:", err);
  process.exit(1);
});
