import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

broadcastResponseToMainFrame().catch((error: unknown) => {
  document.body.textContent =
    error instanceof Error ? error.message : "Authentication failed.";
});
