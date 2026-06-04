import { useState } from "react";
import { Mail, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  smtpHost: string;
  setSmtpHost: (v: string) => void;
  smtpPort: number;
  setSmtpPort: (v: number) => void;
  senderEmail: string;
  setSenderEmail: (v: string) => void;
  smtpPassword: string;
  setSmtpPassword: (v: string) => void;
}

export default function EmailSettings({
  smtpHost,
  setSmtpHost,
  smtpPort,
  setSmtpPort,
  senderEmail,
  setSenderEmail,
  smtpPassword,
  setSmtpPassword,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Mail size={14} />
          <span>Email</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="settings-list animate-fade-in">
          <div className="settings-item">
            <label className="settings-label">SMTP Host</label>
            <input
              type="text"
              className="minimal-input"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.gmail.com"
            />
          </div>
          <div className="settings-item">
            <label className="settings-label">Port</label>
            <input
              type="number"
              className="minimal-input"
              value={smtpPort}
              onChange={(e) => setSmtpPort(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="settings-item">
            <label className="settings-label">Sender Email</label>
            <input
              type="email"
              className="minimal-input"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
            />
          </div>
          <div className="settings-item">
            <label className="settings-label">SMTP Password</label>
            <input
              type="password"
              className="minimal-input"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder="••••••••••••••••"
            />
          </div>
        </div>
      )}
    </section>
  );
}
