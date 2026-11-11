export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { parseServerConfig } = await import("./server/config");
    parseServerConfig(process.env);
  }
}
