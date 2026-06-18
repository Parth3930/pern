import { useEffect } from "react";
import { api } from "../../../lib/api";
import { showNotification } from "../../../lib/notifications";

/**
 * Syncs todos from disk on mount and runs a background interval that
 * checks for due reminders every 5 seconds, firing the TTS `speak`
 * callback and a desktop notification for each due task.
 */
export function useTodoReminders(speak: (text: string) => void) {
  // Sync todos from disk on mount
  useEffect(() => {
    const syncTodos = async () => {
      try {
        const diskTodos = await api.getTodos();
        if (diskTodos) {
          localStorage.setItem("pern_todos", JSON.stringify(diskTodos));
          window.dispatchEvent(new Event("pern_todos_updated"));
        }
      } catch (err) {
        console.error("Failed to sync todos from disk on startup:", err);
      }
    };
    syncTodos();
  }, []);

  // Check for due reminders every 5 seconds
  useEffect(() => {
    const checkTodos = () => {
      try {
        const storedTodos = localStorage.getItem("pern_todos");
        if (!storedTodos) return;
        const todos = JSON.parse(storedTodos);
        let updated = false;

        const now = new Date();

        const updatedTodos = todos.map((todo: any) => {
          if (!todo.completed && !todo.reminded && todo.time) {
            const reminderTime = new Date(todo.time);
            if (reminderTime <= now) {
              speak(
                `Excuse me, this is a reminder for your task: ${todo.text}`,
              );
              showNotification("Todo Reminder", todo.text);

              if (todo.repeat_hours && todo.repeat_hours > 0) {
                const nextTime = new Date(
                  reminderTime.getTime() +
                    todo.repeat_hours * 60 * 60 * 1000,
                );
                todo.time = nextTime.toISOString();
                todo.reminded = false;
              } else {
                todo.reminded = true;
              }
              updated = true;
            }
          }
          return todo;
        });

        if (updated) {
          localStorage.setItem("pern_todos", JSON.stringify(updatedTodos));
          api.saveTodos(updatedTodos).catch((err) => {
            console.error(
              "Failed to save updated todos to disk in background checker:",
              err,
            );
          });
          window.dispatchEvent(new Event("pern_todos_updated"));
        }
      } catch (err) {
        console.error("Error checking todo reminders:", err);
      }
    };

    const interval = setInterval(checkTodos, 5000);
    return () => clearInterval(interval);
  }, [speak]);
}
