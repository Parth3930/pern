import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface WhatsAppContact {
  name: string;
  number: string;
  auto_reply_enabled: boolean;
}

export interface RecentChat {
  jid: string;
  push_name: string;
  last_message: string;
  timestamp: string;
}

export const whatsappApi = {
  startWhatsAppSession: () => invoke<void>("start_whatsapp_session"),
  getWhatsAppStatus: () =>
    invoke<[string, string | null]>("get_whatsapp_status"),
  getRecentChats: () => invoke<RecentChat[]>("get_recent_chats"),
  toggleWhatsApp: (enabled: boolean) =>
    invoke<void>("toggle_whatsapp", { enabled }),
  logoutWhatsApp: () => invoke<void>("logout_whatsapp"),
  addWhatsAppContact: (name: string, number: string) =>
    invoke<void>("add_whatsapp_contact", { name, number }),
  setWhatsAppContactAutoReply: (name: string, enabled: boolean) =>
    invoke<void>("set_whatsapp_contact_auto_reply", { name, enabled }),
  removeWhatsAppContact: (name: string) =>
    invoke<void>("remove_whatsapp_contact", { name }),
  getWhatsAppContacts: () => invoke<WhatsAppContact[]>("get_whatsapp_contacts"),
  sendWhatsAppMessage: (recipient: string, message: string) =>
    invoke<void>("send_whatsapp_message", { recipient, message }),
  setWhatsAppAutoReply: (recipient: string, enabled: boolean) =>
    invoke<string>("set_whatsapp_auto_reply", { recipient, enabled }),
  toggleWhatsAppAutoReply: (recipient: string) =>
    invoke<[string, boolean]>("toggle_whatsapp_auto_reply", { recipient }),


  onWhatsAppQr: (cb: (qr: string | null) => void) =>
    listen<string | null>("whatsapp-qr", (e) => cb(e.payload)),
  onWhatsAppStatus: (cb: (status: string) => void) =>
    listen<string>("whatsapp-status", (e) => cb(e.payload)),
  onWhatsAppRecentChatsUpdated: (cb: () => void) =>
    listen<void>("whatsapp-recent-chats-updated", () => cb()),
  onWhatsAppContactsUpdated: (cb: () => void) =>
    listen<void>("whatsapp-contacts-updated", () => cb()),
};
