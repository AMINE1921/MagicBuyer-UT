import { setValue } from "../services/repository";

export const setRandomInterval = (intervalFunction, start, end) => {
  let timeout;
  let isCleared = false;

  const runInterval = () => {
    if (isCleared) return;
    const searchInterval = {
      start: Date.now(),
    };
    const timeoutFunction = () => {
      intervalFunction();
      runInterval();
    };

    const delay =
      parseFloat((Math.random() * (end - start) + start).toFixed(1)) * 1000;
    searchInterval.end = searchInterval.start + delay;
    setValue("searchInterval", searchInterval);
    timeout = setTimeout(timeoutFunction, delay);
  };

  runInterval();

  return {
    clear() {
      isCleared = true;
      clearTimeout(timeout);
    },
  };
};
