/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { createSingleFlightController } from "../asyncControl";

describe("createSingleFlightController", () => {
  it("shares one promise for concurrent calls with the same key", async () => {
    const run = createSingleFlightController();
    let executions = 0;

    const task = async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return executions;
    };

    const [first, second] = await Promise.all([
      run("disconnect", task),
      run("disconnect", task),
    ]);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(executions).toBe(1);
  });

  it("allows a new run after the previous promise settled", async () => {
    const run = createSingleFlightController();
    let executions = 0;

    const task = async () => {
      executions += 1;
      return executions;
    };

    await run("screen-share", task);
    const next = await run("screen-share", task);

    expect(next).toBe(2);
    expect(executions).toBe(2);
  });
});
