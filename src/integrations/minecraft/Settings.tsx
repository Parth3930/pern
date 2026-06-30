// ponytail: compact Minecraft Settings with local persistence and multi-line layout
import { useState, useEffect } from "react";
import { Gamepad2, Loader2, Link2, Link2Off, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../../lib/api";

export default function MinecraftSettings() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [host, setHost] = useState<string>(() => {
    return localStorage.getItem("pern_minecraft_host") || "";
  });
  const [port, setPort] = useState<string>(() => {
    return localStorage.getItem("pern_minecraft_port") || "";
  });
  const [version, setVersion] = useState<string>(() => {
    return localStorage.getItem("pern_minecraft_version") || "1.20.4";
  });
  const [statusMsg, setStatusMsg] = useState<string>("");

  useEffect(() => {
    let interval: any;
    if (isExpanded) {
      const checkStatus = async () => {
        try {
          const active = await api.getMinecraftStatus();
          setIsConnected(active);
        } catch (e) {
          console.error(e);
        }
      };
      checkStatus();
      interval = setInterval(checkStatus, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isExpanded]);

  const handleHostChange = (val: string) => {
    setHost(val);
    localStorage.setItem("pern_minecraft_host", val);
  };

  const handlePortChange = (val: string) => {
    const clean = val.replace(/\D/g, "");
    setPort(clean);
    localStorage.setItem("pern_minecraft_port", clean);
  };

  const handleVersionChange = (val: string) => {
    setVersion(val);
    localStorage.setItem("pern_minecraft_version", val);
  };

  const handleJoin = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const p = port ? parseInt(port) : undefined;
      const h = host || undefined;
      const res = await api.joinMinecraftWorld(p, h, version);
      setIsConnected(true);
      setStatusMsg(res);
    } catch (e: any) {
      setStatusMsg(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const res = await api.disconnectMinecraftWorld();
      setIsConnected(false);
      setStatusMsg(res);
    } catch (e: any) {
      setStatusMsg(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="settings-section collapsible">
      <div 
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Gamepad2 size={14} style={{ color: isConnected ? "#10b981" : "inherit" }} />
          <span>Minecraft Bot</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="section-content" style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.25rem 0" }}>
          {/* Inputs Row */}
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              className="minimal-input"
              value={host}
              onChange={(e) => handleHostChange(e.target.value)}
              placeholder="IP / Host"
              style={{ width: "110px", height: "30px", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
            />
            <input
              type="text"
              className="minimal-input"
              value={port}
              onChange={(e) => handlePortChange(e.target.value)}
              placeholder="Auto / Port"
              style={{ width: "80px", height: "30px", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
            />
            <input
              type="text"
              className="minimal-input"
              value={version}
              onChange={(e) => handleVersionChange(e.target.value)}
              placeholder="1.20.4"
              style={{ width: "80px", height: "30px", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
            />
          </div>

          {/* Button Row */}
          <div style={{ display: "flex", marginTop: "0.25rem" }}>
            {isConnected ? (
              <button 
                type="button" 
                onClick={handleDisconnect}
                disabled={loading}
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "0.25rem",
                  padding: "0.3rem 0.6rem",
                  borderRadius: "4px",
                  border: "none",
                  background: "#ef4444",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 500
                }}
              >
                {loading ? <Loader2 size={12} className="spin" /> : <Link2Off size={12} />}
                Disconnect
              </button>
            ) : (
              <button 
                type="button" 
                onClick={handleJoin}
                disabled={loading}
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "0.25rem",
                  padding: "0.3rem 0.6rem",
                  borderRadius: "4px",
                  border: "none",
                  background: "#3b82f6",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 500
                }}
              >
                {loading ? <Loader2 size={12} className="spin" /> : <Link2 size={12} />}
                Join World
              </button>
            )}
          </div>
          
          {statusMsg && (
            <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
              {statusMsg}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
