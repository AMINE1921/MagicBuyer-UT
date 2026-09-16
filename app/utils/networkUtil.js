import { sendExternalRequest } from "../services/externalRequest";

export const sendRequest = (url, method, identifier, headers) => {
  return new Promise((resolve, reject) => {
    sendExternalRequest({
      method,
      identifier,
      url,
      headers,
      onload: (res) => {
        const body = res.responseText || res.response || "";
        if (res.status !== 200) {
          return reject({ status: res.status, response: body });
        }
        return resolve(body);
      },
    });
  });
};
