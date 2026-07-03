import { useState, useEffect } from "react";
import { ChevronRight, Trash2, Clock, Check, Plus, Bell, Calendar } from "lucide-react";
import { requestNotificationPermission } from "../lib/notifications";
import { api } from "../lib/api";

export interface Todo {
  id: string;
  text: string;
  time: string; // ISO datetime string or empty
  completed: boolean;
  reminded: boolean;
  repeat_hours?: number; // Optional repeat interval in hours
}

interface Props {
  onClose?: () => void;
  isEmbedded?: boolean;
}

export default function TodoPanel({ onClose, isEmbedded = false }: Props) {
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
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [hasReminder, setHasReminder] = useState(true); // Default to true!
  const [reminderTime, setReminderTime] = useState(() => {
    // Default to 1 hour from now formatted for datetime-local (YYYY-MM-DDTHH:mm)
    const d = new Date();
    d.setHours(d.getHours() + 1);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [repeatHours, setRepeatHours] = useState(0); // Repeat interval in hours
  const [showCompleted, setShowCompleted] = useState(false);

  // Load todos from disk storage with localStorage fallback
  useEffect(() => {
    const loadTodos = async () => {
      try {
        const diskTodos = await api.getTodos();
        setTodos(diskTodos);
        // Sync to localStorage
        localStorage.setItem("pern_todos", JSON.stringify(diskTodos));
      } catch (e) {
        console.error("Failed to load todos from disk", e);
        try {
          const stored = localStorage.getItem("pern_todos");
          if (stored) {
            setTodos(JSON.parse(stored));
          }
        } catch (err) {
          console.error("Failed to load todos from localStorage", err);
        }
      }
    };

    loadTodos();

    // Listen for updates from the background check loop
    window.addEventListener("pern_todos_updated", loadTodos);
    return () => {
      window.removeEventListener("pern_todos_updated", loadTodos);
    };
  }, []);

  // Save todos to disk and localStorage
  const saveTodos = async (updatedTodos: Todo[]) => {
    setTodos(updatedTodos);
    try {
      await api.saveTodos(updatedTodos);
    } catch (e) {
      console.error("Failed to save todos to disk", e);
    }
    localStorage.setItem("pern_todos", JSON.stringify(updatedTodos));
    window.dispatchEvent(new Event("pern_todos_updated"));
  };

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;

    let timeStr = "";
    if (hasReminder && reminderTime) {
      // Request permissions if user sets a reminder
      await requestNotificationPermission();
      timeStr = new Date(reminderTime).toISOString();
    }

    const newTodo: Todo = {
      id: Math.random().toString(36).substring(2, 9),
      text: newTodoText.trim(),
      time: timeStr,
      completed: false,
      reminded: false,
      repeat_hours: hasReminder ? repeatHours : 0,
    };

    const updated = [newTodo, ...todos];
    saveTodos(updated);

    // Reset inputs
    setNewTodoText("");
    setHasReminder(true); // Keep true by default
    // Reset reminderTime to 1 hour from now
    const d = new Date();
    d.setHours(d.getHours() + 1);
    const pad = (n: number) => n.toString().padStart(2, "0");
    setReminderTime(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setRepeatHours(0);
  };

  const handleToggleComplete = (id: string) => {
    const updated = todos.map((todo) => {
      if (todo.id === id) {
        const nextCompleted = !todo.completed;
        if (nextCompleted && todo.repeat_hours && todo.repeat_hours > 0 && todo.time) {
          // It repeats! Advance the schedule and keep active
          const currentScheduled = new Date(todo.time);
          const nextScheduled = new Date(currentScheduled.getTime() + todo.repeat_hours * 60 * 60 * 1000);
          return {
            ...todo,
            time: nextScheduled.toISOString(),
            reminded: false,
            completed: false, // Keep it active for the next occurrence
          };
        }
        return {
          ...todo,
          completed: nextCompleted,
          // If uncompleting, reset reminded status if the reminder time is in the future
          reminded: nextCompleted ? todo.reminded : false,
        };
      }
      return todo;
    });
    saveTodos(updated);
  };

  const handleDeleteTodo = (id: string) => {
    const updated = todos.filter((todo) => todo.id !== id);
    saveTodos(updated);
  };

  const activeTodos = todos.filter((t) => !t.completed);
  const completedTodos = todos.filter((t) => t.completed);

  // Helper to format reminder time
  const formatReminder = (isoString: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    
    // Format options
    const isToday = date.toDateString() === now.toDateString();
    
    const timeOptions: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
    const dateOptions: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    
    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], timeOptions)}`;
    }
    return date.toLocaleDateString([], dateOptions);
  };

  const formAndList = (
    <>
      {/* Add Todo Form */}
      <form className="todo-form" onSubmit={handleAddTodo}>
        <div className="todo-input-group">
          <input
            type="text"
            className="todo-input"
            placeholder="What needs to be done?"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            maxLength={100}
            required
          />
        </div>

        <div className="reminder-toggle-row">
          <span className={`reminder-label ${hasReminder ? "active" : ""}`}>
            <Bell size={12} />
            Set Reminder Time
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={hasReminder}
              onChange={(e) => setHasReminder(e.target.checked)}
            />
            <span className="slider"></span>
          </label>
        </div>

        {hasReminder && (
          <div className="datetime-inputs-row">
            <div className="datetime-container">
              <Calendar size={12} style={{ color: "var(--text-secondary)" }} />
              <input
                type="datetime-local"
                className="datetime-input"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                required={hasReminder}
              />
            </div>
            <div className="datetime-container">
              <Clock size={12} style={{ color: "var(--text-secondary)" }} />
              <select
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "0.8rem",
                  outline: "none",
                  width: "100%",
                  fontFamily: "inherit",
                }}
                value={repeatHours}
                onChange={(e) => setRepeatHours(Number(e.target.value))}
              >
                <option value={0} style={{ background: "var(--bg-tertiary)" }}>Do not repeat</option>
                <option value={1} style={{ background: "var(--bg-tertiary)" }}>Every 1 hour</option>
                <option value={2} style={{ background: "var(--bg-tertiary)" }}>Every 2 hours</option>
                <option value={4} style={{ background: "var(--bg-tertiary)" }}>Every 4 hours</option>
                <option value={8} style={{ background: "var(--bg-tertiary)" }}>Every 8 hours</option>
                <option value={12} style={{ background: "var(--bg-tertiary)" }}>Every 12 hours</option>
                <option value={24} style={{ background: "var(--bg-tertiary)" }}>Daily (24h)</option>
                <option value={168} style={{ background: "var(--bg-tertiary)" }}>Weekly (7 days)</option>
              </select>
            </div>
          </div>
        )}

        <button type="submit" className="add-todo-btn">
          <Plus size={14} />
          Add Task
        </button>
      </form>

      {/* Active Todos List */}
      <div className="todos-list-section">
        <h3 className="section-title">Tasks</h3>
        {activeTodos.length === 0 ? (
          <div className="empty-todos-state">
            <Check size={20} style={{ color: "var(--success)" }} />
            <div className="empty-todos-title">All Caught Up!</div>
            <div className="empty-todos-desc">No pending tasks or reminders.</div>
          </div>
        ) : (
          activeTodos.map((todo) => {
            const isOverdue = todo.time && new Date(todo.time) <= new Date();
            return (
              <div key={todo.id} className="todo-item">
                <div className="todo-checkbox-wrapper">
                  <button
                    type="button"
                    className="todo-checkbox"
                    onClick={() => handleToggleComplete(todo.id)}
                    title="Mark as completed"
                  >
                    <Check size={8} style={{ display: "none" }} />
                  </button>
                </div>

                <div className="todo-details">
                  <span className="todo-text">{todo.text}</span>
                  {todo.time && (
                    <span className={`todo-time-badge ${isOverdue && !todo.reminded ? "due" : ""} ${todo.reminded ? "reminded" : ""}`}>
                      <Clock size={10} />
                      {todo.reminded ? "Reminded" : formatReminder(todo.time)}
                      {todo.repeat_hours && todo.repeat_hours > 0 ? ` • Repeats every ${todo.repeat_hours}h` : ""}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="delete-todo-btn"
                  onClick={() => handleDeleteTodo(todo.id)}
                  title="Delete task"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Completed Todos List */}
      {completedTodos.length > 0 && (
        <div className="todos-list-section" style={{ marginTop: "0.25rem" }}>
          <button
            type="button"
            className="completed-toggle-btn"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            <span>Completed ({completedTodos.length})</span>
            <ChevronRight
              size={12}
              style={{
                transform: showCompleted ? "rotate(90deg)" : "none",
                transition: "transform 0.2s",
              }}
            />
          </button>

          {showCompleted &&
            completedTodos.map((todo) => (
              <div key={todo.id} className="todo-item" style={{ opacity: 0.6 }}>
                <div className="todo-checkbox-wrapper">
                  <button
                    type="button"
                    className="todo-checkbox completed"
                    onClick={() => handleToggleComplete(todo.id)}
                    title="Mark as active"
                  >
                    <Check size={8} />
                  </button>
                </div>

                <div className="todo-details">
                  <span className="todo-text completed">{todo.text}</span>
                  {todo.time && (
                    <span className="todo-time-badge">
                      <Clock size={10} />
                      Completed {todo.repeat_hours && todo.repeat_hours > 0 ? ` • Repeats every ${todo.repeat_hours}h` : ""}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="delete-todo-btn"
                  onClick={() => handleDeleteTodo(todo.id)}
                  title="Delete task"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </div>
      )}
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
        border-radius: 8px;
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .todo-input-group {
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

      .reminder-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.1rem 0;
      }

      .reminder-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;
        color: var(--text-secondary);
        cursor: pointer;
      }

      .reminder-label.active {
        color: var(--text-primary);
      }

      .switch {
        position: relative;
        display: inline-block;
        width: 34px;
        height: 20px;
      }

      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #333;
        transition: .3s;
        border-radius: 20px;
      }

      .slider:before {
        position: absolute;
        content: "";
        height: 14px;
        width: 14px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .3s;
        border-radius: 50%;
      }

      input:checked + .slider {
        background-color: var(--text-secondary);
      }

      input:checked + .slider:before {
        transform: translateX(14px);
      }

      .datetime-inputs-row {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .datetime-container {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.4rem;
        animation: slideDownFade 0.2s ease-out;
      }

      .datetime-input {
        background: transparent;
        border: none;
        color: var(--text-primary);
        font-size: 0.8rem;
        outline: none;
        width: 100%;
        font-family: inherit;
        color-scheme: dark;
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

      .add-todo-btn:active {
        transform: scale(0.98);
      }

      .todos-list-section {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .section-title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin-bottom: 0.1rem;
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

      .todo-item:hover {
        border-color: rgba(255, 255, 255, 0.1);
      }

      .todo-checkbox-wrapper {
        display: flex;
        align-items: center;
        padding-top: 0.1rem;
      }

      .todo-checkbox {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--text-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        background: transparent;
      }

      .todo-checkbox.completed {
        background-color: var(--success);
        border-color: var(--success);
        color: #0f0f0f;
      }

      .todo-checkbox:hover:not(.completed) {
        border-color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.05);
      }

      .todo-details {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .todo-text {
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--text-primary);
        line-height: 1.3;
        word-break: break-word;
      }

      .todo-text.completed {
        text-decoration: line-through;
        color: var(--text-secondary);
      }

      .todo-time-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.7rem;
        color: var(--text-secondary);
      }

      .todo-time-badge.due {
        color: #f59e0b;
      }

      .todo-time-badge.reminded {
        color: var(--success);
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

      .completed-toggle-btn {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        width: 100%;
      }

      .completed-toggle-btn:hover {
        color: var(--text-primary);
      }

      .empty-todos-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        color: var(--text-secondary);
        text-align: center;
        gap: 0.4rem;
      }

      .empty-todos-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text-primary);
      }

      .empty-todos-desc {
        font-size: 0.75rem;
        opacity: 0.8;
      }

      @keyframes slideDownFade {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes slideUp {
        from {
          transform: translateY(100%);
        }
        to {
          transform: translateY(0);
        }
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
            <h2 className="todos-title">Todos & Reminders</h2>
          </div>
        </div>

        <div className="todos-content">
          {formAndList}
        </div>
      </div>
    </div>
  );
}
