import { invoke } from "@tauri-apps/api/core";

export const emailApi = {
  sendEmail: (to: string, subject: string, body: string) =>
    invoke<any>("send_email", { to, subject, body }),
  saveEmailConfig: (
    smtpHost: string,
    smtpPort: number,
    senderEmail: string,
    smtpPassword: string,
  ) =>
    invoke<void>("save_email_config", {
      smtpHost,
      smtpPort,
      senderEmail,
      smtpPassword,
    }),
};
