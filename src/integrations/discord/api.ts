import { invoke } from "@tauri-apps/api/core";

export const discordApi = {
  discordTestToken: (token: string) =>
    invoke<string>("discord_test_token", { token }),
  getDiscordStatus: () =>
    invoke<[string, string | null]>("get_discord_status"),
  setDiscordStatus: (status?: string, activity?: string) =>
    invoke<string>("set_discord_status", { status, activity }),
  discordGetGuilds: () =>
    invoke<[string, string][]>("discord_get_guilds"),
  toggleDiscord: (
    enabled: boolean,
    token: string,
    status: string,
    activity: string,
    ownerId: string,
    behaviourChannelId: string,
  ) =>
    invoke<void>("toggle_discord", {
      enabled,
      token,
      status,
      activity,
      ownerId,
      behaviourChannelId,
    }),
  discordKick: (guildId: string, userId: string, reason?: string) =>
    invoke<void>("discord_kick", { guildId, userId, reason }),
  discordBan: (
    guildId: string,
    userId: string,
    reason?: string,
    deleteMessageSeconds?: number,
  ) =>
    invoke<void>("discord_ban", {
      guildId,
      userId,
      reason,
      deleteMessageSeconds,
    }),
  discordUnban: (guildId: string, userId: string) =>
    invoke<void>("discord_unban", { guildId, userId }),
  discordMute: (
    guildId: string,
    userId: string,
    durationMins: number,
    reason?: string,
  ) => invoke<void>("discord_mute", { guildId, userId, durationMins, reason }),
  discordUnmute: (guildId: string, userId: string) =>
    invoke<void>("discord_unmute", { guildId, userId }),
  discordWarn: (guildId: string | null, userId: string, reason: string) =>
    invoke<void>("discord_warn", { guildId, userId, reason }),
  discordDeleteMessages: (channelId: string, count: number) =>
    invoke<void>("discord_delete_messages", { channelId, count }),
  discordAssignRole: (guildId: string, userId: string, roleId: string) =>
    invoke<void>("discord_assign_role", { guildId, userId, roleId }),
  discordRemoveRole: (guildId: string, userId: string, roleId: string) =>
    invoke<void>("discord_remove_role", { guildId, userId, roleId }),
  discordSendDm: (userId: string, message: string) =>
    invoke<string>("discord_send_dm", { userId, message }),
  discordSendChannelMessage: (guildId: string, channelName: string, message: string) =>
    invoke<string>("discord_send_channel_message", { guildId, channelName, message }),
  discordGetChannels: (guildId: string) =>
    invoke<any>("discord_get_channels", { guildId }),
  setDiscordBehaviourChannel: (channelId: string) =>
    invoke<string>("set_discord_behaviour_channel", { channelId }),
  getUserBehaviour: (userId: string) =>
    invoke<string>("get_user_behaviour", { userId }),
  getSystemStatus: () =>
    invoke<string>("get_system_status"),
};
