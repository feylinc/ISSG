const io = require("socket.io-client");
const readline = require("readline");
const crypto = require("crypto");

const DEFAULT_ALG = "sha256"; 
const algFromEnv = process.env.HASH_ALG;
const algFromArg = process.argv[2];
const HASH_ALG = (algFromArg || algFromEnv || DEFAULT_ALG).toLowerCase();

const ALLOWED = new Set(["md5", "sha1", "sha256"]);
if (!ALLOWED.has(HASH_ALG)) {
  console.warn(
    `Warning: unsupported HASH_ALG "${HASH_ALG}", falling back to ${DEFAULT_ALG}. Supported: md5, sha1, sha256.`
  );
}

const ALG = ALLOWED.has(HASH_ALG) ? HASH_ALG : DEFAULT_ALG;

function computeHash(user, msg) {
  return crypto.createHash(ALG).update(`${user}|${msg}`).digest("hex");
}

const socket = io("http://localhost:3000");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

let username = "";

socket.on("connect", () => {
  console.log(`Connected to the server (hash alg: ${ALG})`);

  rl.question("Enter your username: ", (input) => {
    username = (input || "").trim() || "anonymous";
    console.log(`Welcome, ${username} to the chat`);
    rl.prompt();

    rl.on("line", (line) => {
      const message = (line || "").trim();
      if (!message) {
        rl.prompt();
        return;
      }

      const hash = computeHash(username, message);
      socket.emit("message", { username, message, hash });
      console.log(`(you) ${username}: ${message}`);
      rl.prompt();
    });
  });
});

socket.on("message", (data) => {
  if (!data || typeof data !== "object") {
    rl.prompt();
    return;
  }

  const { username: senderUsername, message: senderMessage, hash } = data;

  if (!senderUsername || typeof senderMessage !== "string") {
    rl.prompt();
    return;
  }

  if (senderUsername === username) {
    rl.prompt();
    return;
  }

  if (!hash) {
    console.log(
      `[!] ${senderUsername}: ${senderMessage}  -- WARNING: the message may have been changed during transmission (missing hash)`
    );
    rl.prompt();
    return;
  }

  const expected = computeHash(senderUsername, senderMessage);
  if (expected !== hash) {
    console.log(
      `[!] ${senderUsername}: ${senderMessage}  -- WARNING: the message may have been changed during transmission (hash mismatch)`
    );
  } else {
    console.log(`${senderUsername}: ${senderMessage}`);
  }

  rl.prompt();
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  try { rl.close(); } catch (e) {}
  process.exit(0);
});

rl.on("SIGINT", () => {
  console.log("\nExiting...");
  socket.disconnect();
  try { rl.close(); } catch (e) {}
  process.exit(0);
});
