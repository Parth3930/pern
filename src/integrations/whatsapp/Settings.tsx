import { useState, useEffect, useRef } from "react";
import { MessageCircle, ChevronDown, ChevronRight, UserCheck, X, Loader2 } from "lucide-react";
import { api, AppConfig, WhatsAppContact } from "../../lib/api";

interface Props {
  config: AppConfig;
}

export default function WhatsAppSettings({ config }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<
    "idle" | "starting" | "qr" | "connected"
  >("idle");
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [whatsappContacts, setWhatsappContacts] = useState<WhatsAppContact[]>(
    config.whatsapp_contacts || [],
  );

  const [newContactName, setNewContactName] = useState("");
  const [newContactNumber, setNewContactNumber] = useState("");

  // Keep a ref so event listener closures can read the latest busy state
  // without needing to be re-registered on every render.
  const busyRef = useRef(false);
  const setWhatsappBusySynced = (v: boolean) => {
    busyRef.current = v;
    setWhatsappBusy(v);
  };

  useEffect(() => {
    setWhatsappContacts(config.whatsapp_contacts || []);
  }, [config.whatsapp_contacts]);

  const refreshContacts = async () => {
    try {
      const contacts = await api.getWhatsAppContacts();
      setWhatsappContacts(contacts);
    } catch (e) {
      console.error("Failed to refresh WhatsApp contacts", e);
    }
  };

  useEffect(() => {
    let unlistenQr: any;
    let unlistenStatus: any;
    let unlistenContacts: any;

    const setupListeners = async () => {
      try {
        const [status, qr] = await api.getWhatsAppStatus();
        setWhatsappQr(qr);
        setWhatsappStatus(
          status === "connecting" ? "starting" : (status as any),
        );
      } catch (e) {
        console.error("Failed to fetch WhatsApp status", e);
      }

      refreshContacts();

      unlistenQr = await api.onWhatsAppQr((qr) => {
        setWhatsappQr(qr);
        if (qr) {
          setWhatsappStatus("qr");
        } else if (!busyRef.current) {
          // Only go idle from a QR clear if no op is in progress
          setWhatsappStatus("idle");
        }
      });

      unlistenStatus = await api.onWhatsAppStatus((status) => {
        if (status === "connected") {
          setWhatsappStatus("connected");
          setWhatsappQr(null);
          return;
        }
        if (status === "connecting" || status === "starting") {
          setWhatsappStatus("starting");
          return;
        }
        if (status === "qr") {
          setWhatsappStatus("qr");
          return;
        }
        // "idle" — only apply if no operation is in progress.
        // During logout, the backend briefly emits "idle" between stopping the
        // old session and starting the new one; swallowing it prevents the
        // Login button from flashing back for a moment.
        if (!busyRef.current) {
          setWhatsappStatus("idle");
        }
      });

      unlistenContacts = await api.onWhatsAppContactsUpdated(() => {
        refreshContacts();
      });
    };

    setupListeners();

    return () => {
      if (unlistenQr) unlistenQr();
      if (unlistenStatus) unlistenStatus();
      if (unlistenContacts) unlistenContacts();
    };
  }, []);

  const handleAddContact = async () => {
    const name = newContactName.trim();
    const number = newContactNumber.trim();
    if (!name || !number) return;

    try {
      await api.addWhatsAppContact(name, number);
      const updated = whatsappContacts.filter(
        (c) => c.name.toLowerCase() !== name.toLowerCase() && c.number !== number,
      );
      setWhatsappContacts([
        ...updated,
        { name, number, auto_reply_enabled: true },
      ]);
      setNewContactName("");
      setNewContactNumber("");
    } catch (e) {
      console.error("Failed to add contact", e);
    }
  };

  const handleRemoveContact = async (name: string) => {
    try {
      await api.removeWhatsAppContact(name);
      setWhatsappContacts(whatsappContacts.filter((c) => c.name !== name));
    } catch (e) {
      console.error("Failed to remove contact", e);
    }
  };

  const handleStartWhatsApp = async () => {
    if (whatsappBusy) return;
    setWhatsappBusySynced(true);
    setWhatsappStatus("starting");
    try {
      await api.startWhatsAppSession();
    } catch (e) {
      console.error("Failed to start WhatsApp", e);
      setWhatsappStatus("idle");
    } finally {
      setWhatsappBusySynced(false);
    }
  };

  const handleLogout = async () => {
    if (whatsappBusy) return;
    setWhatsappBusySynced(true);
    setWhatsappStatus("starting");
    setWhatsappQr(null);
    try {
      await api.logoutWhatsApp();
    } catch (e) {
      console.error("Failed to logout WhatsApp", e);
      setWhatsappStatus("idle");
    } finally {
      setWhatsappBusySynced(false);
    }
  };

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <MessageCircle size={14} />
          <span>WhatsApp</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="settings-list animate-fade-in">
          <div className="settings-item">
            <label className="settings-label">
              Manage Contacts (Auto-allows these numbers)
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              <input
                type="text"
                className="minimal-input"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Name (e.g. Rover)"
              />
              <input
                type="text"
                className="minimal-input"
                value={newContactNumber}
                onChange={(e) => setNewContactNumber(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddContact()}
                placeholder="Number (e.g. 911234567890)"
              />
              <button
                className="minimal-btn primary"
                onClick={handleAddContact}
                style={{ width: "100%", padding: "0.6rem 1.2rem" }}
              >
                Add
              </button>
            </div>

            <div
              className="allowed-numbers-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                marginTop: "1rem",
              }}
            >
              {whatsappContacts.length === 0 && (
                <span style={{ fontSize: "0.7rem", opacity: 0.5 }}>
                  No contacts mapped yet.
                </span>
              )}
              {whatsappContacts.map((contact) => (
                <div
                  key={contact.name + contact.number}
                  className="number-tag"
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "0.3rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <UserCheck size={12} />
                      <span style={{ fontWeight: 600 }}>
                        {contact.name || "Unnamed"}
                      </span>
                      <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>
                        ({contact.number})
                      </span>
                    </div>
                    <button onClick={() => handleRemoveContact(contact.name)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.75rem",
                    }}
                  >
                    <span>Auto-Reply:</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={contact.auto_reply_enabled}
                        onChange={async () => {
                          const newVal = !contact.auto_reply_enabled;
                          await api.setWhatsAppContactAutoReply(
                            contact.name,
                            newVal,
                          );
                          setWhatsappContacts(
                            whatsappContacts.map((c) =>
                              c.name === contact.name
                                ? { ...c, auto_reply_enabled: newVal }
                                : c,
                            ),
                          );
                        }}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="whatsapp-auth-area">
            {whatsappStatus === "idle" && (
              <button
                className="minimal-btn"
                onClick={handleStartWhatsApp}
                disabled={whatsappBusy}
              >
                Login to WhatsApp
              </button>
            )}
            {whatsappStatus === "starting" && (
              <div className="auth-status">
                <Loader2 size={16} className="animate-spin" />
                <span>Initializing...</span>
              </div>
            )}
            {whatsappStatus === "qr" && whatsappQr && (
              <div className="qr-container">
                <p>Scan this QR code with WhatsApp</p>
                <img src={whatsappQr} alt="WhatsApp QR" />
              </div>
            )}
            {whatsappStatus === "connected" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  width: "100%",
                }}
              >
                <div className="auth-status success">
                  <span>✓ Connected to WhatsApp</span>
                </div>
                <button
                  className="minimal-btn"
                  style={{ width: "100%", fontSize: "0.75rem" }}
                  onClick={handleLogout}
                  disabled={whatsappBusy}
                >
                  {whatsappBusy ? "Resetting..." : "Logout / Reset Session"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
