/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { sendDesktopVoiceLog } from "@/lib/desktop";

function buildPayload(getContext, fields = {}, error = null) {
  const baseContext = typeof getContext === "function" ? (getContext() || {}) : {};
  const payload = {
    ...baseContext,
    ...fields,
  };

  if (error) {
    payload.error = error?.message || String(error);
  }

  return payload;
}

function emit(method, message, payload) {
  const consoleMethod = console?.[method] || console.log;
  consoleMethod(`[VoiceEngine] ${message}`, payload);
  void sendDesktopVoiceLog(method, message, payload);
}

export function createVoiceLogger(getContext = () => ({})) {
  return {
    debug(message, fields = {}) {
      emit("debug", message, buildPayload(getContext, fields));
    },
    info(message, fields = {}) {
      emit("info", message, buildPayload(getContext, fields));
    },
    warn(message, fields = {}, error = null) {
      emit("warn", message, buildPayload(getContext, fields, error));
    },
    error(message, fields = {}, error = null) {
      emit("error", message, buildPayload(getContext, fields, error));
    },
  };
}
