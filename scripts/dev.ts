const processes = [
  {
    name: "api",
    command: ["bun", "--hot", "apps/api/src/index.ts"],
    env: { PORT: process.env.API_PORT ?? "8787" },
  },
  {
    name: "web",
    command: ["bun", "--hot", "apps/web/src/dev.ts"],
    env: { PORT: process.env.WEB_PORT ?? "3000" },
  },
];

const children = processes.map((processConfig) =>
  Bun.spawn(processConfig.command, {
    env: { ...process.env, ...processConfig.env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
);

function stopChildren() {
  for (const child of children) {
    child.kill();
  }
}

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

const exitCode = await Promise.race(children.map((child) => child.exited));
stopChildren();
process.exit(exitCode);
