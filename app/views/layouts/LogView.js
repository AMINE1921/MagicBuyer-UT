import { idLog, idProgressAutobuyer } from "../../elementIds.constants";
import { clearLogs } from "../../utils/logUtil";
import { createButton } from "./ButtonView";

export const logView = () => {
  const logContainer = $(`<div style=${
    !isPhone()
      ? "width:48%"
      : "height: 90%;display: flex;flex-direction: column;padding: 7px;"
  } id=${idLog}>
            <div class="logs-container">
              <div data-title="Clear logs" class="button-clear">
              </div>
            </div>
            <br/>
            <div class="logWrapper">
            <ul wrap="off"  style="height: 100%;overflow-x: auto;resize: none; width: 100%;" id=${idProgressAutobuyer} class="autoBuyerLog"></ul>
            <br/>
        </div>`);
  const buttons = logContainer.find(".button-clear");
  buttons.append(createButton("⎚", () => clearLogs()).__root);
  return logContainer;
};

export const initializeLog = () => {
  const log = $("#" + idProgressAutobuyer);
  log.empty();
};
