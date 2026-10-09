import { t } from "../i18n";
import { isRunning } from "./engine";
import { beginTask, currentTask, endTask } from "./tasks";
import { usageLimitMessage } from "./usage";

// Tâche manuelle lancée depuis un outil (prix min EA, club, packs, galerie) : jamais pendant que
// le bot tourne, ni en même temps qu'une autre tâche (une seule suite de requêtes EA à la fois).
export const startToolTask = (label) => {
  if (isRunning()) {
    return { task: null, error: t("tools.errBotRunning") };
  }
  const limit = usageLimitMessage();
  if (limit) {
    return { task: null, error: limit };
  }
  const task = beginTask(label);
  if (!task) {
    const other = currentTask();
    return { task: null, error: t("tools.errOtherTask", { task: other ? other.label : "?" }) };
  }
  return { task, error: "" };
};

// Exécute fn(task) sous verrou ; renvoie { ok: false, error } si la tâche ne peut pas démarrer.
export const runToolTask = async (label, fn) => {
  const { task, error } = startToolTask(label);
  if (!task) {
    return { ok: false, error };
  }
  try {
    return await fn(task);
  } finally {
    endTask(task);
  }
};
