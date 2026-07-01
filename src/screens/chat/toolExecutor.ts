import { api } from "../../lib/api";
import {
  ToolCall,
  ToolResult,
  getStringArg,
  getNumberArg,
  getBooleanArg,
  getExactStringArg,
  validateEmailToolArgs,
  getErrorMessage,
} from "../chatLogic";

export async function executeSingleTool(
  tc: ToolCall,
  context: {
    successfulWhatsAppRecipients: string[];
    successfulWhatsAppMessageRef: React.MutableRefObject<string>;
    needsConfigRefreshRef: React.MutableRefObject<boolean>;
    projectName?: string;
  }
): Promise<ToolResult> {
  let result: ToolResult;
  if (tc.tool === "close_app") {
    const appName = getStringArg(tc.args, "app_name");
    result = appName
      ? await api.closeApp(appName)
      : { ok: false, error: "The app name was missing." };
  } else if (tc.tool === "launch_app") {
    const appName = getStringArg(tc.args, "app_name");
    result = appName
      ? await api.launchApp(appName)
      : { ok: false, error: "The app name was missing." };
  } else if (tc.tool === "add_todo") {
    const text = getStringArg(tc.args, "text");
    const time = getStringArg(tc.args, "time") || "";
    const repeatHours = getNumberArg(tc.args, "repeat_hours") || 0;

    if (!text) {
      result = { ok: false, error: "Task text is required." };
    } else {
      const stored = localStorage.getItem("pern_todos");
      const todos = stored ? JSON.parse(stored) : [];

      let resolvedTime = time;
      if (repeatHours > 0 && !resolvedTime) {
        const futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + repeatHours);
        resolvedTime = futureDate.toISOString();
      }

      const newTodo = {
        id: Math.random().toString(36).substring(2, 9),
        text: text.trim(),
        time: resolvedTime ? new Date(resolvedTime).toISOString() : "",
        completed: false,
        reminded: false,
        repeat_hours: repeatHours,
      };

      todos.unshift(newTodo);
      localStorage.setItem("pern_todos", JSON.stringify(todos));
      try {
        await api.saveTodos(todos);
      } catch (err) {
        console.error("Failed to save todos to disk:", err);
      }
      window.dispatchEvent(new Event("pern_todos_updated"));

      result = {
        ok: true,
        message: `Added todo: "${text}"${resolvedTime ? ` scheduled for ${new Date(resolvedTime).toLocaleString()}` : ""}${repeatHours > 0 ? ` (repeats every ${repeatHours} hours)` : ""}.`
      };
    }
  } else if (tc.tool === "restart_system") {
    result = await api.restartSystem();
  } else if (tc.tool === "shutdown_system") {
    result = await api.shutdownSystem();
  } else if (tc.tool === "send_email") {
    const validationError = validateEmailToolArgs(tc.args);
    if (validationError) {
      result = { ok: false, error: validationError };
    } else {
      const body = getExactStringArg(tc.args, "body");
      result = await api.sendEmail(
        getStringArg(tc.args, "to"),
        getStringArg(tc.args, "subject"),
        body,
      );
    }
  } else if (tc.tool === "set_discord_status") {
    const status = getStringArg(tc.args, "status") || undefined;
    const activity = getStringArg(tc.args, "activity") || undefined;
    if (!status && !activity) {
      result = { ok: false, error: "Status or activity missing." };
    } else {
      const message = await api.setDiscordStatus(status, activity);
      result = { ok: true, message };
    }
  } else if (tc.tool === "add_whatsapp_contact") {
    const name = getStringArg(tc.args, "name");
    const number = getStringArg(tc.args, "number");
    if (!name || !number) {
      result = { ok: false, error: "Name or number missing." };
    } else {
      await api.addWhatsAppContact(name, number);
      result = { ok: true };
      context.needsConfigRefreshRef.current = true;
    }
  } else if (tc.tool === "set_whatsapp_contact_auto_reply") {
    const name = getStringArg(tc.args, "name");
    const enabled = getBooleanArg(tc.args, "enabled");
    if (!name || enabled === undefined) {
      result = { ok: false, error: "Name or enabled status missing." };
    } else {
      await api.setWhatsAppContactAutoReply(name, enabled);
      result = { ok: true };
      context.needsConfigRefreshRef.current = true;
    }
  } else if (tc.tool === "set_whatsapp_auto_reply") {
    const recipient =
      getStringArg(tc.args, "recipient") || getStringArg(tc.args, "name");
    const enabled = getBooleanArg(tc.args, "enabled");
    if (!recipient || enabled === undefined) {
      result = {
        ok: false,
        error: "Recipient or enabled status missing.",
      };
    } else {
      const actualName = await api.setWhatsAppAutoReply(
        recipient,
        enabled,
      );
      result = {
        ok: true,
        status: `Auto-reply ${enabled ? "enabled" : "disabled"} for contact ${actualName} on WhatsApp.`,
      };
      context.needsConfigRefreshRef.current = true;
    }
  } else if (tc.tool === "toggle_whatsapp_auto_reply") {
    const recipient =
      getStringArg(tc.args, "recipient") || getStringArg(tc.args, "name");
    if (!recipient) {
      result = { ok: false, error: "Recipient missing." };
    } else {
      try {
        const [actualName, newState] =
          await api.toggleWhatsAppAutoReply(recipient);
        result = {
          ok: true,
          status: `Toggled auto-reply on WhatsApp. It is now ${newState ? "enabled" : "disabled"} for contact ${actualName}.`,
        };
      } catch (e) {
        try {
          const refreshed = await api.getWhatsAppContacts();
          const recipientLower = recipient.toLowerCase();
          const recipientKey = recipientLower.replace(/[^a-z0-9]/g, "");
          const matches = refreshed.find((c) => {
            const nameLower = c.name.toLowerCase();
            const nameKey = nameLower.replace(/[^a-z0-9]/g, "");
            return (
              nameLower === recipientLower ||
              nameLower.includes(recipientLower) ||
              recipientLower.includes(nameLower) ||
              (nameKey &&
                recipientKey &&
                (nameKey === recipientKey ||
                  nameKey.includes(recipientKey) ||
                  recipientKey.includes(nameKey)))
            );
          });

          if (matches) {
            result = {
              ok: true,
              status: `Auto-reply is now ${matches.auto_reply_enabled ? "enabled" : "disabled"} for contact ${matches.name} on WhatsApp.`,
            };
          } else {
            result = {
              ok: true,
              status: `Auto-reply toggle sent for contact ${recipient} on WhatsApp. (Couldn't verify state in chat.)`,
            };
          }
        } catch (_refreshError) {
          result = {
            ok: true,
            status: `Auto-reply toggle sent for contact ${recipient} on WhatsApp. (Couldn't verify state in chat.)`,
          };
        }
      }
      context.needsConfigRefreshRef.current = true;
    }
  } else if (tc.tool === "toggle_whatsapp") {
    const enabled = getBooleanArg(tc.args, "enabled");
    if (enabled === undefined) {
      result = { ok: false, error: "Enabled status missing." };
    } else {
      await api.toggleWhatsApp(enabled);
      result = { ok: true };
      context.needsConfigRefreshRef.current = true;
    }
  } else if (tc.tool === "send_whatsapp_message") {
    const recipient = getStringArg(tc.args, "recipient");
    const message = getStringArg(tc.args, "message");
    if (!recipient || !message) {
      result = { ok: false, error: "Recipient or message missing." };
    } else {
      await api.sendWhatsAppMessage(recipient, message);
      result = { ok: true };
      context.successfulWhatsAppRecipients.push(recipient);
      context.successfulWhatsAppMessageRef.current = message;
    }
  } else if (tc.tool === "save_email_config") {
    const smtpHost = getStringArg(tc.args, "smtp_host");
    const smtpPort = getNumberArg(tc.args, "smtp_port");
    const senderEmail = getStringArg(tc.args, "sender_email");
    const smtpPassword = getStringArg(tc.args, "smtp_password");

    if (!smtpHost || smtpPort === null || !senderEmail || !smtpPassword) {
      result = {
        ok: false,
        error: "The email settings were incomplete.",
      };
    } else {
      await api.saveEmailConfig(
        smtpHost,
        smtpPort,
        senderEmail,
        smtpPassword,
      );
      result = { ok: true };
      context.needsConfigRefreshRef.current = true;
    }
  } else if (tc.tool === "discord_kick") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    const reason = getStringArg(tc.args, "reason") || undefined;
    if (!guildId || !userId) {
      result = { ok: false, error: "Guild ID or User ID missing." };
    } else {
      await api.discordKick(guildId, userId, reason);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_ban") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    const reason = getStringArg(tc.args, "reason") || undefined;
    const deleteSecs =
      getNumberArg(tc.args, "delete_message_seconds") || undefined;
    if (!guildId || !userId) {
      result = { ok: false, error: "Guild ID or User ID missing." };
    } else {
      await api.discordBan(guildId, userId, reason, deleteSecs);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_unban") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    if (!guildId || !userId) {
      result = { ok: false, error: "Guild ID or User ID missing." };
    } else {
      await api.discordUnban(guildId, userId);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_mute") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    const duration = getNumberArg(tc.args, "duration_mins");
    const reason = getStringArg(tc.args, "reason") || undefined;
    if (!guildId || !userId || duration === null) {
      result = {
        ok: false,
        error: "Guild ID, User ID, or duration missing.",
      };
    } else {
      await api.discordMute(guildId, userId, duration, reason);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_unmute") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    if (!guildId || !userId) {
      result = { ok: false, error: "Guild ID or User ID missing." };
    } else {
      await api.discordUnmute(guildId, userId);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_warn") {
    const guildId = getStringArg(tc.args, "guild_id") || null;
    const userId = getStringArg(tc.args, "user_id");
    const reason = getStringArg(tc.args, "reason");
    if (!userId || !reason) {
      result = { ok: false, error: "User ID or warning reason missing." };
    } else {
      await api.discordWarn(guildId, userId, reason);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_delete_messages") {
    const channelId = getStringArg(tc.args, "channel_id");
    const count = getNumberArg(tc.args, "count");
    if (!channelId || count === null) {
      result = {
        ok: false,
        error: "Channel ID or message count missing.",
      };
    } else {
      await api.discordDeleteMessages(channelId, count);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_assign_role") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    const roleId = getStringArg(tc.args, "role_id");
    if (!guildId || !userId || !roleId) {
      result = {
        ok: false,
        error: "Guild ID, User ID, or Role ID missing.",
      };
    } else {
      await api.discordAssignRole(guildId, userId, roleId);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_remove_role") {
    const guildId = getStringArg(tc.args, "guild_id");
    const userId = getStringArg(tc.args, "user_id");
    const roleId = getStringArg(tc.args, "role_id");
    if (!guildId || !userId || !roleId) {
      result = {
        ok: false,
        error: "Guild ID, User ID, or Role ID missing.",
      };
    } else {
      await api.discordRemoveRole(guildId, userId, roleId);
      result = { ok: true };
    }
  } else if (tc.tool === "discord_get_guilds") {
    const guilds = await api.discordGetGuilds();
    result = { ok: true, guilds };
  } else if (tc.tool === "discord_send_dm") {
    const userId = getStringArg(tc.args, "user_id");
    const message = getStringArg(tc.args, "message");
    if (!userId || !message) {
      result = { ok: false, error: "User ID or message missing." };
    } else {
      const status = await api.discordSendDm(userId, message);
      result = { ok: true, message: status };
    }
  } else if (tc.tool === "discord_send_channel_message") {
    const guildId = getStringArg(tc.args, "guild_id");
    const channelName = getStringArg(tc.args, "channel_name");
    const message = getStringArg(tc.args, "message");
    if (!guildId || !channelName || !message) {
      result = {
        ok: false,
        error: "Guild ID, channel name, or message missing.",
      };
    } else {
      const status = await api.discordSendChannelMessage(
        guildId,
        channelName,
        message,
      );
      result = { ok: true, message: status };
    }
  } else if (tc.tool === "discord_get_channels") {
    const guildId = getStringArg(tc.args, "guild_id");
    if (!guildId) {
      result = { ok: false, error: "Guild ID missing." };
    } else {
      const channelsVal = await api.discordGetChannels(guildId);
      if (Array.isArray(channelsVal)) {
        let list = "Here are the channels in this server:\n";
        for (const c of channelsVal) {
          if (c.name) {
            const typeStr =
              c.type === 0
                ? "text"
                : c.type === 2
                  ? "voice"
                  : c.type === 4
                    ? "category"
                    : c.type === 5
                      ? "announcement"
                      : "other";
            list += `- **#${c.name}** (ID: \`${c.id}\`, Type: ${typeStr})\n`;
          }
        }
        result = { ok: true, message: list };
      } else {
        result = {
          ok: true,
          message: "Could not retrieve channel list.",
        };
      }
    }
  } else if (tc.tool === "set_discord_behaviour_channel") {
    const channelId = getStringArg(tc.args, "channel_id");
    if (!channelId) {
      result = { ok: false, error: "Channel ID missing." };
    } else {
      const status = await api.setDiscordBehaviourChannel(channelId);
      result = { ok: true, message: status };
    }
  } else if (tc.tool === "get_user_behaviour") {
    const userId = getStringArg(tc.args, "user_id");
    if (!userId) {
      result = { ok: false, error: "User ID missing." };
    } else {
      const analysis = await api.getUserBehaviour(userId);
      result = { ok: true, message: analysis };
    }
  } else if (tc.tool === "get_status") {
    const status = await api.getSystemStatus();
    result = { ok: true, message: status };
  } else if (tc.tool === "send_to_cli_agent") {
    const agentName = getStringArg(tc.args, "agent_name");
    const prompt = getStringArg(tc.args, "prompt");
    const projectName =
      getStringArg(tc.args, "project_name") || undefined;
    if (!agentName || !prompt) {
      result = { ok: false, error: "Agent name or prompt missing." };
    } else {
      try {
        const projectSuffix = projectName
          ? ` in project "${projectName}"`
          : "";
        await api.sendToCLIAgent(agentName, prompt, projectName);
        result = {
          ok: true,
          message: `Task sent to ${agentName}${projectSuffix}. I'll notify you when it completes.`,
        };
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else if (tc.tool === "get_cli_agents_status") {
    try {
      const agents = await api.getCLIAgentsStatus();
      const lines = agents.map((a) => {
        const statusIcon =
          a.status === "running"
            ? "🔄"
            : a.status === "completed"
              ? "✅"
              : a.status === "failed"
                ? "❌"
                : a.status === "not_found"
                  ? "⚠️"
                  : "💤";
        const taskStr = a.current_task
          ? ` (working on: ${a.current_task.slice(0, 60)})`
          : "";
        return `${statusIcon} **${a.display_name}**: ${a.status}${taskStr}`;
      });
      result = {
        ok: true,
        message: `**CLI Agent Status:**\n${lines.join("\n")}`,
      };
    } catch (e) {
      result = { ok: false, error: getErrorMessage(e) };
    }
  } else if (tc.tool === "remember_fact") {
    const category = getStringArg(tc.args, "category").toLowerCase();
    const key = getStringArg(tc.args, "key");
    const value = getStringArg(tc.args, "value");
    const rawAliases = Array.isArray(tc.args.aliases) ? tc.args.aliases : [];
    const aliases: string[] = rawAliases
      .map((a: unknown) =>
        typeof a === "string" ? a.trim() : String(a ?? "").trim(),
      )
      .filter((a: string) => a.length > 0);

    if (!category || !key || !value) {
      result = {
        ok: false,
        error: "remember_fact requires category, key, and value.",
      };
    } else {
      try {
        const entity = await api.memoryAddEntity(
          category,
          key,
          value,
          aliases,
        );
        result = {
          ok: true,
          message: `Saved ${entity.key} to memory.`,
          memory_result: {
            kind: "remember",
            key: entity.key,
            value: entity.value,
            category: entity.category,
          },
        };
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else if (tc.tool === "recall_fact") {
    const query = getStringArg(tc.args, "query");
    const k = getNumberArg(tc.args, "k") ?? 10;
    if (!query) {
      result = { ok: false, error: "recall_fact requires a query." };
    } else {
      try {
        const hits = await api.memorySearch(query, k);
        if (!hits || hits.length === 0) {
          result = { ok: true, message: "No matching memory." };
        } else {
          const lines = hits
            .map(
              (h) =>
                `- ${h.entity.category} · ${h.entity.key}: ${h.entity.value}`,
            )
            .join("\n");
          result = {
            ok: true,
            message: `**Memory matches:**\n${lines}`,
            memory_result: { kind: "recall", query, hits },
          };
        }
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else if (tc.tool === "forget_fact") {
    const key = getStringArg(tc.args, "key");
    if (!key) {
      result = { ok: false, error: "forget_fact requires a key." };
    } else {
      try {
        // Resolve key or alias to an id before deleting.
        const all = await api.memoryListEntities();
        const lc = key.toLowerCase();
        const match = all.find(
          (e) =>
            e.key.toLowerCase() === lc ||
            e.aliases.some((a) => a.toLowerCase() === lc),
        );
        if (!match) {
          result = {
            ok: false,
            error: `No memory entry found for "${key}".`,
          };
        } else {
          const confirmed =
            typeof window !== "undefined" && typeof window.confirm === "function"
              ? window.confirm(
                  `Forget memory entry "${match.key}" (${match.value})? This cannot be undone.`,
                )
              : true;
          if (!confirmed) {
            result = {
              ok: false,
              error: `Cancelled: kept memory entry "${match.key}".`,
            };
          } else {
            await api.memoryDeleteEntity(match.id);
            result = {
              ok: true,
              message: `Forgot ${match.key}.`,
              memory_result: { kind: "forget", key: match.key },
            };
          }
        }
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else if (tc.tool === "join_minecraft_world") {
    const port = getNumberArg(tc.args, "port") || undefined;
    const host = getStringArg(tc.args, "host") || undefined;
    const version = getStringArg(tc.args, "version") || undefined;
    try {
      const msg = await api.joinMinecraftWorld(port, host, version);
      result = { ok: true, message: msg };
    } catch (e) {
      result = { ok: false, error: getErrorMessage(e) };
    }
  } else if (tc.tool === "disconnect_minecraft_world") {
    try {
      const msg = await api.disconnectMinecraftWorld();
      result = { ok: true, message: msg };
    } catch (e) {
      result = { ok: false, error: getErrorMessage(e) };
    }
  } else if (tc.tool === "read_file") {
    const path = getStringArg(tc.args, "path");
    const projectName = context.projectName || "Pern";
    if (!path) {
      result = { ok: false, error: "File path missing." };
    } else {
      try {
        const msg = await api.read_file(path, projectName);
        result = { ok: true, message: msg };
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else if (tc.tool === "list_dir") {
    const path = getStringArg(tc.args, "path");
    const projectName = context.projectName || "Pern";
    if (!path) {
      result = { ok: false, error: "Directory path missing." };
    } else {
      try {
        const msg = await api.list_dir(path, projectName);
        result = { ok: true, message: msg };
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else if (tc.tool === "web_search") {
    const query = getStringArg(tc.args, "query");
    if (!query) {
      result = { ok: false, error: "Search query missing." };
    } else {
      try {
        const msg = await api.webSearch(query);
        result = { ok: true, message: msg };
      } catch (e) {
        result = { ok: false, error: getErrorMessage(e) };
      }
    }
  } else {
    result = {
      ok: false,
      error: `Tool "${tc.tool}" is not implemented.`,
    };
  }
  return result;
}
