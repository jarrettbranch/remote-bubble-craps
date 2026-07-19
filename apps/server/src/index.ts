import { readConfig } from "./config.js";
import { SimulatedDiceDevice } from "./device/SimulatedDiceDevice.js";
import { BubbleCrapsServer } from "./gameServer.js";

const config = readConfig();
const device = new SimulatedDiceDevice({
  rollDelayMs: config.simulatedRollDelayMs
});

const server = new BubbleCrapsServer({ config, device });

console.log("Bubble Craps auth config", {
  authMode: config.authMode,
  entraAuthority: config.entraAuthority,
  entraAudience: config.entraAudience,
  entraIssuer: config.entraIssuer
});

server
  .listen()
  .then((port) => {
    console.log(`Bubble Craps server listening on ws://localhost:${port}/ws`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server
      .close()
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        process.exit(0);
      });
  });
}
