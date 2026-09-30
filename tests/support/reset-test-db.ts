import setup from "./integration-global-setup";

// Recreates and seeds examcore_test before the E2E server starts.
setup()
  .then(() => console.log("[e2e] examcore_test ready"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
