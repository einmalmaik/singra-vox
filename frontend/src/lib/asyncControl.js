/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * Serialisiert gleichartige Async-Aktionen per Schlüssel.
 *
 * Mehrfache, parallele Aufrufe derselben Lifecycle-Aktion teilen sich dieselbe
 * Promise. Das verhindert doppelte Cleanup-Läufe, die bei Voice-/Screen-Share-
 * Stops besonders kritisch wären.
 */
export function createSingleFlightController() {
  const inFlight = new Map();

  return function run(key, task) {
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }

    const promise = Promise.resolve().then(task);
    inFlight.set(key, promise);

    const clear = () => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    };

    promise.then(clear, clear);
    return promise;
  };
}
