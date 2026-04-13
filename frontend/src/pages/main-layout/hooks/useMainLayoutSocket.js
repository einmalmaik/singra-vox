/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function closeSocketManually(socket, code, reason) {
  if (!socket) {
    return;
  }
  socket.__singravoxManualClose = true;
  try {
    socket.close(code, reason);
  } catch {
    // Ignore close races on already-closing sockets.
  }
}

export function isManualSocketClose(socket) {
  return Boolean(socket?.__singravoxManualClose);
}

/**
 * Encapsulates the workspace WebSocket lifecycle. It owns reconnect/backoff,
 * manual-close semantics and heartbeat handling, while delegating payload
 * handling back to the page controller.
 */
export function useMainLayoutSocket({
  token,
  wsBase,
  isDesktop,
  currentServerRef,
  currentDmUserRef,
  onRefreshCurrentServer,
  onRefreshDmConversations,
  onEvent,
  onSessionRevoked,
}) {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const heartbeatTimerRef = useRef(null);
  const sessionInvalidatedRef = useRef(false);
  const connectWsRef = useRef(null);
  const refreshCurrentServerRef = useRef(onRefreshCurrentServer);
  const refreshDmConversationsRef = useRef(onRefreshDmConversations);
  const eventHandlerRef = useRef(onEvent);
  const sessionRevokedHandlerRef = useRef(onSessionRevoked);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    refreshCurrentServerRef.current = onRefreshCurrentServer;
  }, [onRefreshCurrentServer]);

  useEffect(() => {
    refreshDmConversationsRef.current = onRefreshDmConversations;
  }, [onRefreshDmConversations]);

  useEffect(() => {
    eventHandlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    sessionRevokedHandlerRef.current = onSessionRevoked;
  }, [onSessionRevoked]);

  useEffect(() => {
    sessionInvalidatedRef.current = false;
  }, [token]);

  const connectWs = useCallback(() => {
    if (!token || !wsBase || sessionInvalidatedRef.current) {
      return;
    }

    if (wsRef.current) {
      closeSocketManually(wsRef.current);
    }

    const platform = isDesktop ? "desktop" : "web";
    const socket = new WebSocket(`${wsBase}/api/ws?token=${token}&platform=${platform}`);
    wsRef.current = socket;

    socket.onopen = () => {
      setWsConnected(true);
      reconnectAttemptRef.current = 0;
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }

      heartbeatTimerRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 20000);

      if (currentServerRef.current?.id) {
        void refreshCurrentServerRef.current?.(currentServerRef.current.id);
      }
      if (currentDmUserRef.current?.id) {
        void refreshDmConversationsRef.current?.();
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "pong") {
          return;
        }
        if (data.type === "session_revoked") {
          sessionInvalidatedRef.current = true;
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          closeSocketManually(socket, 4001, "session_revoked");
          void sessionRevokedHandlerRef.current?.(data);
          return;
        }
        void eventHandlerRef.current?.(data);
      } catch {
        // Ignore malformed socket payloads.
      }
    };

    socket.onclose = () => {
      setWsConnected(false);
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      // Manual closes are used when switching sockets or logging out. They
      // must not trigger reconnect loops that would immediately re-open again.
      if (sessionInvalidatedRef.current || isManualSocketClose(socket)) {
        return;
      }
      const delay = Math.min(1000 * (2 ** reconnectAttemptRef.current), 30000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        connectWsRef.current?.();
      }, delay);
    };

    socket.onerror = () => socket.close();
  }, [currentDmUserRef, currentServerRef, isDesktop, token, wsBase]);

  useEffect(() => {
    connectWsRef.current = connectWs;
  }, [connectWs]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    connectWs();

    return () => {
      if (wsRef.current) {
        closeSocketManually(wsRef.current);
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connectWs, token]);

  const sendJson = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const closeConnection = useCallback((code, reason) => {
    if (wsRef.current) {
      closeSocketManually(wsRef.current, code, reason);
    }
  }, []);

  return {
    wsConnected,
    sendJson,
    closeConnection,
  };
}
