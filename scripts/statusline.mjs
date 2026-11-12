// Claude Code statusline for Claude Monitor. Claude Code pipes the statusline JSON to stdin after
// each assistant message. This forwards it to the monitor (which reads only `rate_limits`) and
// prints a short line: model and the quota left. Never fails: a stopped monitor changes nothing.
// The installer passes --port, since Claude Code runs this without the monitor's environment.
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.CLAUDE_MONITOR_PORT) || 4317;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // Print what we can.
  }
  const left = (w) => (w && typeof w.used_percentage === "number" ? `${Math.max(0, Math.round(100 - w.used_percentage))}%` : "?");
  const parts = [data?.model?.display_name ?? "Claude"];
  if (data?.rate_limits) parts.push(`5h ${left(data.rate_limits.five_hour)} left`, `week ${left(data.rate_limits.seven_day)} left`);
  process.stdout.write(parts.join(" · "));

  if (data?.rate_limits) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/statusline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rate_limits: data.rate_limits }),
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      // Monitor not running.
    }
  }
});
