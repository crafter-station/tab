import { env } from "./env.ts";

const processes = [
  {
    name: "api",
    command: ["bun", "--hot", "apps/api/src/index.ts"],
    env: { PORT: String(env.API_PORT) },
  },
  {
    name: "web",
    command: ["bun", "run", "--cwd", "apps/web", "dev"],
    env: { PORT: String(env.WEB_PORT) },
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
