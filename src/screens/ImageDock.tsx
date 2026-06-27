import React, { useState, useRef } from "react";
import { Plus, Download, Loader2 } from "lucide-react";

export default function ImageDock() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const processImage = async (file: File) => {
    setLoading(true);
    try {
      let sourceBlob: Blob = file;

      if (window.confirm("Remove background? (Will download ~40MB ML model on first run)")) {
        const { removeBackground } = await import('@imgly/background-removal');
        sourceBlob = await removeBackground(sourceBlob);
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          // ponytail: native canvas upscale (2x)
          canvas.width = img.width * 2;
          canvas.height = img.height * 2;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // ponytail: native compress/format (PNG quality 0.8)
            setImgUrl(canvas.toDataURL("image/png", 0.8));
          }
          setLoading(false);
        };
        if (typeof ev.target?.result === "string") img.src = ev.target.result;
      };
      reader.readAsDataURL(sourceBlob);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleProcess = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImage(file);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--bg-secondary, #222)", padding: 10, borderRadius: 20, display: "flex", gap: 10, zIndex: 1000, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", alignItems: "center" }}>
      <input type="file" ref={fileInput} onChange={handleProcess} style={{ display: "none" }} accept="image/*" />
      {loading ? (
        <div style={{ width: 50, height: 50, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent, #4ade80)" }}>
          <Loader2 className="animate-spin" size={24} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : !imgUrl ? (
        <button onClick={() => fileInput.current?.click()} style={{ width: 50, height: 50, borderRadius: "50%", border: "none", background: "var(--accent, #4ade80)", color: "#000", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Upload Image">
          <Plus size={24} />
        </button>
      ) : (
        <>
          <img src={imgUrl} alt="processed" style={{ height: 50, borderRadius: 10 }} />
          <a href={imgUrl} download="processed.png" style={{ width: 50, height: 50, borderRadius: "50%", border: "none", background: "var(--accent, #4ade80)", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }} title="Download PNG">
            <Download size={24} />
          </a>
          <button onClick={() => setImgUrl(null)} style={{ background: "transparent", color: "white", border: "none", cursor: "pointer" }}>✕</button>
        </>
      )}
    </div>
  );
}
