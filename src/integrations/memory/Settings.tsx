import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search as SearchIcon,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  Entity,
  EntityCategory,
  EntityPatch,
} from "../../lib/api";

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

const CATEGORIES: { value: EntityCategory; label: string }[] = [
  { value: "person", label: "Person" },
  { value: "project", label: "Project" },
  { value: "preference", label: "Preference" },
  { value: "recurring_task", label: "Recurring Task" },
  { value: "other", label: "Other" },
];

const CATEGORY_LABEL: Record<EntityCategory, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.value] = c.label;
    return acc;
  },
  {} as Record<EntityCategory, string>,
);

// Display order for grouping. "Other" falls through last.
const CATEGORY_ORDER: EntityCategory[] = [
  "person",
  "project",
  "preference",
  "recurring_task",
  "other",
];

const isEntityCategory = (v: string): v is EntityCategory =>
  v === "person" ||
  v === "project" ||
  v === "preference" ||
  v === "recurring_task" ||
  v === "other";

// ---------------------------------------------------------------------------
// Inline form for add / edit
// ---------------------------------------------------------------------------

interface EntityFormValues {
  category: EntityCategory;
  key: string;
  value: string;
  aliasesRaw: string;
}

interface EntityFormProps {
  mode: "add" | "edit";
  initial?: Entity;
  onCancel: () => void;
  onSubmit: (values: EntityFormValues) => Promise<void>;
}

const EntityForm: React.FC<EntityFormProps> = ({
  mode,
  initial,
  onCancel,
  onSubmit,
}) => {
  const [category, setCategory] = useState<EntityCategory>(
    initial && isEntityCategory(initial.category) ? initial.category : "other",
  );
  const [keyValue, setKeyValue] = useState<string>(initial?.key ?? "");
  const [valueValue, setValueValue] = useState<string>(initial?.value ?? "");
  const [aliasesRaw, setAliasesRaw] = useState<string>(
    (initial?.aliases ?? []).join(", "),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedKey = keyValue.trim();
    const trimmedValue = valueValue.trim();
    if (!trimmedKey) {
      setError("Key is required.");
      return;
    }
    if (!trimmedValue) {
      setError("Value is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ category, key: trimmedKey, value: trimmedValue, aliasesRaw });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <form
      className="memory-entity-form"
      onSubmit={handleSubmit}
      aria-label={mode === "add" ? "Add memory entity" : `Edit ${initial?.key}`}
    >
      <div className="memory-entity-form__row">
        <label className="settings-label" htmlFor={`mem-cat-${mode}`}>
          Category
        </label>
        <select
          id={`mem-cat-${mode}`}
          className="minimal-input"
          value={category}
          onChange={(e) =>
            setCategory(
              isEntityCategory(e.target.value)
                ? e.target.value
                : "other",
            )
          }
          disabled={submitting}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="memory-entity-form__row">
        <label className="settings-label" htmlFor={`mem-key-${mode}`}>
          Key
        </label>
        <input
          id={`mem-key-${mode}`}
          type="text"
          className="minimal-input"
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
          placeholder="e.g. robert"
          autoFocus
          disabled={submitting}
        />
      </div>
      <div className="memory-entity-form__row">
        <label className="settings-label" htmlFor={`mem-value-${mode}`}>
          Value
        </label>
        <textarea
          id={`mem-value-${mode}`}
          className="minimal-input memory-entity-form__textarea"
          value={valueValue}
          onChange={(e) => setValueValue(e.target.value)}
          placeholder="e.g. Robert is a backend engineer who prefers Go."
          rows={2}
          disabled={submitting}
        />
      </div>
      <div className="memory-entity-form__row">
        <label className="settings-label" htmlFor={`mem-aliases-${mode}`}>
          Aliases (optional, comma-separated)
        </label>
        <input
          id={`mem-aliases-${mode}`}
          type="text"
          className="minimal-input"
          value={aliasesRaw}
          onChange={(e) => setAliasesRaw(e.target.value)}
          placeholder="e.g. Bob, Bobby"
          disabled={submitting}
        />
      </div>
      {error && (
        <div
          className="memory-entity-form__error"
          role="alert"
          style={{ color: "#ef4444" }}
        >
          {error}
        </div>
      )}
      <div className="memory-entity-form__actions">
        <button
          type="button"
          className="minimal-btn"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="minimal-btn primary"
          disabled={submitting}
        >
          {submitting
            ? mode === "add"
              ? "Saving..."
              : "Updating..."
            : mode === "add"
              ? "Add to memory"
              : "Save"}
        </button>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Row renderer
// ---------------------------------------------------------------------------

interface EntityRowProps {
  entity: Entity;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}

const EntityRow: React.FC<EntityRowProps> = ({
  entity,
  onEdit,
  onDelete,
  deleting,
}) => {
  const categoryLabel = CATEGORY_LABEL[entity.category] ?? entity.category;
  return (
    <div className="memory-entity-row" role="listitem">
      <div className="memory-entity-row__main">
        <div className="memory-entity-row__head">
          <span className="memory-entity-row__category">{categoryLabel}</span>
          <span className="memory-entity-row__key">{entity.key}</span>
        </div>
        <div
          className="memory-entity-row__value"
          title={entity.value}
        >
          {entity.value}
        </div>
        {entity.aliases && entity.aliases.length > 0 && (
          <div className="memory-entity-row__aliases">
            aka {entity.aliases.join(", ")}
          </div>
        )}
      </div>
      <div className="memory-entity-row__actions">
        <button
          type="button"
          className="icon-only-btn"
          onClick={onEdit}
          title={`Edit ${entity.key}`}
          aria-label={`Edit ${entity.key}`}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="icon-only-btn"
          onClick={onDelete}
          disabled={deleting}
          title={`Delete ${entity.key}`}
          aria-label={`Delete ${entity.key}`}
          style={{ color: "#ef4444" }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main settings section
// ---------------------------------------------------------------------------

export default function MemorySettings() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // search (debounced 250ms) — calls api.memorySearch when query non-empty,
  // falls back to listing everything when empty.
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // form/row interaction state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Re-fetch a flat list of all entities (no search query).
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.memoryListEntities();
      setEntities(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[MEMORY] Failed to list entities:", e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced live search — only triggered by the debounce timer.
  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setIsSearchActive(false);
      await loadAll();
      return;
    }
    setSearching(true);
    setError(null);
    setIsSearchActive(true);
    try {
      const hits = await api.memorySearch(q, 50);
      // Deduplicate by id and sort by descending score.
      const byId = new Map<string, Entity>();
      for (const h of hits) {
        if (!byId.has(h.entity.id)) byId.set(h.entity.id, h.entity);
      }
      const seen = Array.from(byId.values());
      setEntities(seen);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[MEMORY] Search failed:", e);
      setError(msg);
    } finally {
      setSearching(false);
    }
  }, [loadAll]);

  // Wire the debounce on input change.
  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch(value);
      }, 250);
    },
    [runSearch],
  );

  // Initial load when expanded for the first time.
  useEffect(() => {
    if (isExpanded) {
      void loadAll();
    }
  }, [isExpanded, loadAll]);

  // Cancel any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ----- group by category -----
  const grouped = useMemo(() => {
    const map = new Map<EntityCategory, Entity[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const e of entities) {
      if (isEntityCategory(e.category)) {
        map.get(e.category)!.push(e);
      } else {
        map.get("other")!.push({ ...e, category: "other" });
      }
    }
    // sort each group by key for stable display
    for (const [, arr] of map) {
      arr.sort((a, b) => a.key.localeCompare(b.key));
    }
    return map;
  }, [entities]);

  const totalCount = entities.length;

  // ----- handlers -----
  const handleAdd = async (values: {
    category: EntityCategory;
    key: string;
    value: string;
    aliasesRaw: string;
  }) => {
    const aliases = values.aliasesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await api.memoryAddEntity(
      values.category,
      values.key,
      values.value,
      aliases,
    );
    setShowAddForm(false);
    setStatus(`Added "${values.key}" to memory.`);
    setError(null);
    if (isSearchActive && searchInput.trim().length > 0) {
      await runSearch(searchInput);
    } else {
      await loadAll();
    }
  };

  const handleEdit = async (id: string, values: {
    category: EntityCategory;
    key: string;
    value: string;
    aliasesRaw: string;
  }) => {
    const aliases = values.aliasesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const patch: EntityPatch = {
      category: values.category,
      key: values.key,
      value: values.value,
      aliases,
    };
    await api.memoryUpdateEntity(id, patch);
    setEditingId(null);
    setStatus(`Updated "${values.key}".`);
    setError(null);
    if (isSearchActive && searchInput.trim().length > 0) {
      await runSearch(searchInput);
    } else {
      await loadAll();
    }
  };

  const handleDelete = async (entity: Entity) => {
    const confirmed =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(
            `Delete memory entry "${entity.key}" (${entity.value})? This cannot be undone.`,
          )
        : true;
    if (!confirmed) return;
    setDeletingId(entity.id);
    setError(null);
    try {
      await api.memoryDeleteEntity(entity.id);
      setStatus(`Deleted "${entity.key}".`);
      if (isSearchActive && searchInput.trim().length > 0) {
        await runSearch(searchInput);
      } else {
        await loadAll();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[MEMORY] Delete failed:", e);
      setError(msg);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Brain size={14} />
          <span>Memory</span>
          {!isExpanded && totalCount > 0 && (
            <span
              style={{
                fontSize: "0.65rem",
                color: "var(--text-secondary)",
                fontWeight: 500,
                marginLeft: "0.2rem",
              }}
            >
              ({totalCount})
            </span>
          )}
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="settings-list animate-fade-in memory-settings-shell">
          <div className="settings-item">
            <label className="settings-label">
              Long-term memory facts Pern can recall later.
            </label>

            <div className="memory-settings-toolbar">
              <div className="memory-settings-search">
                <SearchIcon
                  size={14}
                  className="memory-settings-search__icon"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  className="minimal-input memory-settings-search__input"
                  placeholder="Search memory..."
                  value={searchInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  aria-label="Search memory"
                />
                {searchInput.length > 0 && (
                  <button
                    type="button"
                    className="memory-settings-search__clear"
                    onClick={() => handleSearchInput("")}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="minimal-btn primary memory-settings-add-btn"
                onClick={() => {
                  setShowAddForm((v) => !v);
                  setEditingId(null);
                }}
                aria-expanded={showAddForm}
                title="Add a new memory entry"
              >
                <Plus size={12} />
                {showAddForm ? "Close" : "Add entity"}
              </button>
            </div>

            {showAddForm && (
              <div className="memory-settings-card">
                <EntityForm
                  mode="add"
                  onCancel={() => setShowAddForm(false)}
                  onSubmit={handleAdd}
                />
              </div>
            )}

            {error && (
              <div
                className="memory-settings-status"
                style={{ color: "#ef4444" }}
                role="alert"
              >
                <AlertCircle size={12} />
                <span>{error}</span>
              </div>
            )}
            {status && !error && (
              <div
                className="memory-settings-status"
                style={{ color: "#22c55e" }}
                role="status"
              >
                <CheckCircle2 size={12} />
                <span>{status}</span>
              </div>
            )}

            {loading || searching ? (
              <div className="memory-settings-empty">
                {isSearchActive ? "Searching..." : "Loading memory..."}
              </div>
            ) : totalCount === 0 ? (
              <div className="memory-settings-empty">
                {isSearchActive
                  ? `No memory matches "${searchInput}".`
                  : "Pern doesn't remember anything yet. Try saying \"remember that I prefer dark mode\" in chat."}
              </div>
            ) : (
              <div className="memory-settings-groups">
                {CATEGORY_ORDER.map((cat) => {
                  const list = grouped.get(cat) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={cat} className="memory-settings-group">
                      <div className="memory-settings-group__header">
                        {CATEGORY_LABEL[cat]}
                        <span className="memory-settings-group__count">
                          {list.length}
                        </span>
                      </div>
                      <div className="memory-settings-group__list" role="list">
                        {list.map((entity) => {
                          if (editingId === entity.id) {
                            return (
                              <div
                                key={entity.id}
                                className="memory-settings-card"
                              >
                                <EntityForm
                                  mode="edit"
                                  initial={entity}
                                  onCancel={() => setEditingId(null)}
                                  onSubmit={(values) =>
                                    handleEdit(entity.id, values)
                                  }
                                />
                              </div>
                            );
                          }
                          return (
                            <EntityRow
                              key={entity.id}
                              entity={entity}
                              onEdit={() => {
                                setEditingId(entity.id);
                                setShowAddForm(false);
                              }}
                              onDelete={() => void handleDelete(entity)}
                              deleting={deletingId === entity.id}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
