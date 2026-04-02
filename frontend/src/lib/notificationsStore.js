import api from "@/lib/api";

let state = {
  notifications: [],
  unreadCount: 0,
  loaded: false,
};

const listeners = new Set();
let inFlightLoad = null;

function emit() {
  listeners.forEach((listener) => listener(state));
}

function setState(nextState) {
  state = nextState;
  emit();
}

export function getNotificationsState() {
  return state;
}

export function subscribeNotifications(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadNotifications({ force = false, limit = 30 } = {}) {
  if (inFlightLoad && !force) {
    return inFlightLoad;
  }

  inFlightLoad = api.get(`/notifications?limit=${limit}`)
    .then((response) => {
      setState({
        notifications: response.data.notifications || [],
        unreadCount: response.data.unread_count || 0,
        loaded: true,
      });
      return state;
    })
    .finally(() => {
      inFlightLoad = null;
    });

  return inFlightLoad;
}

export function pushNotification(notification) {
  if (!notification?.id) {
    return;
  }

  const existing = state.notifications.find((entry) => entry.id === notification.id);
  const notifications = existing
    ? state.notifications.map((entry) => (entry.id === notification.id ? { ...entry, ...notification } : entry))
    : [notification, ...state.notifications].slice(0, 50);
  const unreadCount = notification.read
    ? state.unreadCount
    : existing
      ? state.unreadCount
      : state.unreadCount + 1;

  setState({
    ...state,
    notifications,
    unreadCount,
    loaded: true,
  });
}

export function markNotificationReadLocal(id) {
  let decremented = false;
  const notifications = state.notifications.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    if (!entry.read) {
      decremented = true;
    }
    return { ...entry, read: true };
  });

  setState({
    ...state,
    notifications,
    unreadCount: decremented ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
  });
}

export function markAllNotificationsReadLocal() {
  setState({
    ...state,
    notifications: state.notifications.map((entry) => ({ ...entry, read: true })),
    unreadCount: 0,
  });
}

export function removeNotificationLocal(id) {
  const target = state.notifications.find((entry) => entry.id === id);
  setState({
    ...state,
    notifications: state.notifications.filter((entry) => entry.id !== id),
    unreadCount: target && !target.read ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
  });
}
