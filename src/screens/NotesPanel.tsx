import { useState, useEffect } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";

export interface Note {
  id: string;
  text: string;
  time: string;
}

interface Props {
  onClose?: () => void;
  isEmbedded?: boolean;
}

export default function NotesPanel({ onClose, isEmbedded = false }: Props) {
  useEffect(() => {
    if (!onClose) return;
    const handlePopState = () => {
      onClose();
    };
    window.history.pushState({ panelOpen: true }, '');
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.panelOpen) {
        window.history.back();
      }
    };
  }, [onClose]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");

  useEffect(() => {
    const loadNotes = async () => {
      try {
        const diskNotes = await api.getNotes();
        setNotes(diskNotes);
        localStorage.setItem("pern_notes", JSON.stringify(diskNotes));
      } catch (e) {
        console.error("Failed to load notes", e);
        try {
          const stored = localStorage.getItem("pern_notes");
          if (stored) setNotes(JSON.parse(stored));
        } catch (err) {
          // ignore
        }
      }
    };
    loadNotes();

    const handleNotesUpdated = () => loadNotes();
    window.addEventListener("pern_notes_updated", handleNotesUpdated);
    return () => {
      window.removeEventListener("pern_notes_updated", handleNotesUpdated);
    };
  }, []);

  const saveNotes = async (updatedNotes: Note[]) => {
    setNotes(updatedNotes);
    try {
      await api.saveNotes(updatedNotes);
    } catch (e) {
      console.error("Failed to save notes", e);
    }
    localStorage.setItem("pern_notes", JSON.stringify(updatedNotes));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    const added = [{ id: Math.random().toString(36).substring(2, 9), text: newNote.trim(), time: new Date().toISOString() }, ...notes];
    await saveNotes(added);
    setNewNote("");
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const kept = notes.filter(n => n.id !== id);
    await saveNotes(kept);
  };

  const handleEditSave = async () => {
    if (!editingNoteId) return;
    const updated = notes.map(n => n.id === editingNoteId ? { ...n, text: editNoteText } : n);
    await saveNotes(updated);
    setEditingNoteId(null);
  };

  const formAndList = (
    <>
      <form className="todo-form" onSubmit={handleAdd}>
        <textarea
          className="todo-input"
          style={{ minHeight: "80px", resize: "vertical", padding: "0.5rem" }}
          placeholder="Take a note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          required
        />
        <button type="submit" className="add-todo-btn">
          <Plus size={14} /> Add Note
        </button>
      </form>
      <div className="todos-list-section">
        {notes.map(note => (
          <div key={note.id} className="todo-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem", cursor: "pointer", padding: "0.5rem" }} onClick={() => { if (editingNoteId !== note.id) { setEditingNoteId(note.id); setEditNoteText(note.text); } }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
              <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>
                {new Date(note.time).toLocaleString()}
              </span>
              <button type="button" className="delete-todo-btn" onClick={(e) => handleDelete(note.id, e)}>
                <Trash2 size={12} />
              </button>
            </div>
            {editingNoteId === note.id ? (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <textarea
                  autoFocus
                  style={{ width: "100%", minHeight: "60px", resize: "vertical", padding: "0.25rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "0.8rem", fontFamily: "inherit" }}
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setEditingNoteId(null); }} style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem", borderRadius: "4px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", cursor: "pointer" }}>Cancel</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleEditSave(); }} style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem", borderRadius: "4px", border: "none", background: "var(--text-primary)", color: "var(--bg-primary)", cursor: "pointer" }}>Save</button>
                </div>
              </div>
            ) : (
              <div className="todo-text" style={{ whiteSpace: "pre-wrap", width: "100%", userSelect: "text", fontSize: "0.8rem" }}>
                {note.text}
              </div>
            )}
          </div>
        ))}
        {notes.length === 0 && (
          <div className="empty-todos-state">
            <div className="empty-todos-desc">No notes taken yet.</div>
          </div>
        )}
      </div>
    </>
  );

  const styleBlock = (
    <style>{`
      .todos-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--bg-primary);
        display: flex;
        flex-direction: column;
        z-index: 1001;
        animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        overflow: hidden;
      }
      .todos-panel {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
      }
      .todos-header {
        height: 60px;
        padding: 0 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--border);
      }
      .todos-title-area {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .todos-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0;
        color: var(--text-primary);
      }
      .todos-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .todos-panel-embedded {
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: 1rem;
      }
      .todo-form {
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .todo-input {
        background: transparent;
        border: none;
        border-bottom: 1px solid var(--border);
        color: var(--text-primary);
        padding: 0.4rem 0;
        font-size: 0.9rem;
        outline: none;
        transition: border-color 0.2s;
        font-family: inherit;
      }
      .todo-input:focus {
        border-color: var(--text-secondary);
      }
      .add-todo-btn {
        background: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.5rem;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        transition: transform 0.15s, background-color 0.2s;
      }
      .add-todo-btn:hover {
        background-color: var(--border);
      }
      .todos-list-section {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .todo-item {
        background-color: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.6rem 0.8rem;
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        transition: transform 0.2s, border-color 0.2s;
      }
      .todo-text {
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--text-primary);
        line-height: 1.3;
        word-break: break-word;
      }
      .delete-todo-btn {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .delete-todo-btn:hover {
        color: #ef4444;
        background-color: rgba(239, 68, 68, 0.1);
      }
      .back-btn {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .back-btn:hover {
        background-color: rgba(255, 255, 255, 0.05);
        color: var(--text-primary);
      }
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `}</style>
  );

  if (isEmbedded) {
    return (
      <div className="todos-panel-embedded" style={{ padding: "0.25rem 0" }}>
        {styleBlock}
        {formAndList}
      </div>
    );
  }

  return (
    <div className="todos-overlay">
      {styleBlock}
      <div className="todos-panel">
        <div className="todos-header">
          <div className="todos-title-area">
            <button type="button" className="back-btn" onClick={onClose} title="Back">
              <ChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
            </button>
            <h2 className="todos-title">Notes</h2>
          </div>
        </div>
        <div className="todos-content">
          {formAndList}
        </div>
      </div>
    </div>
  );
}
