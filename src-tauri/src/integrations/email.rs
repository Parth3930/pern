use lettre::{
    message::{Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct EmailConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub sender_email: String,
    pub smtp_password: String,
}

fn normalize_email_body(body: &str) -> String {
    body.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n")
}

pub async fn send_email(
    config: &EmailConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), String> {
    let sender: Mailbox = config
        .sender_email
        .parse()
        .map_err(|e| format!("Invalid sender: {}", e))?;

    let recipient: Mailbox = to
        .parse()
        .map_err(|e| format!("Invalid recipient: {}", e))?;

    let normalized_body = normalize_email_body(body);

    let email = Message::builder()
        .from(sender)
        .to(recipient.clone())
        .subject(subject)
        .multipart(MultiPart::alternative().singlepart(SinglePart::plain(normalized_body)))
        .map_err(|e| format!("Failed to build email: {}", e))?;

    let creds = Credentials::new(config.sender_email.clone(), config.smtp_password.clone());

    let mailer: AsyncSmtpTransport<Tokio1Executor> = if config.smtp_port == 465 {
        // Implicit TLS on port 465 — use SMTPS, not STARTTLS
        use lettre::transport::smtp::client::Tls;
        use lettre::transport::smtp::client::TlsParameters;
        let tls_params = TlsParameters::builder(config.smtp_host.clone())
            .build()
            .map_err(|e| format!("Failed to build TLS parameters: {}", e))?;
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.smtp_host)
            .port(config.smtp_port)
            .tls(Tls::Wrapper(tls_params))
            .credentials(creds)
            .build()
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
            .map_err(|e| format!("Invalid SMTP host config: {}", e))?
            .port(config.smtp_port)
            .credentials(creds)
            .build()
    };

    mailer
        .send(email)
        .await
        .map_err(|e| format!("Failed to send email: {}", e))?;

    Ok(())
}
