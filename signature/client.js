const io = require("socket.io-client");
const readline = require("readline");
const crypto = require("crypto");

const socket = io("http://localhost:3000");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

let registeredUsername = "";
let username = "";
const users = new Map(); 

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" });

function signMessage(msg) {
  const sig = crypto.sign("sha256", Buffer.from(msg), privateKey);
  return sig.toString("base64");
}

function verifySignature(publicKeyPem, msg, signatureBase64) {
  try {
    const sigBuf = Buffer.from(signatureBase64, "base64");
    const pubKeyObj = crypto.createPublicKey(publicKeyPem);
    return crypto.verify("sha256", Buffer.from(msg), pubKeyObj, sigBuf);
  } catch (e) {
    return false;
  }
}

socket.on("registerRejected", (data) => {
  const { username: rejectedName, reason } = data;
  console.log(`\n[!] Registration rejected for "${rejectedName}": ${reason}`);
  console.log("Please restart the client and pick a different username.");
  rl.prompt();
});

socket.on("connect", () => {
  console.log("Connected to the server");

  rl.question("Enter your username: ", (input) => {
    username = (input || "").trim();
    if (!username) username = "anonymous";
    registeredUsername = username;
    console.log(`Welcome, ${username} to the chat`);

    socket.emit("registerPublicKey", {
      username,
      publicKey: publicKeyPem,
    });
    rl.prompt();

    rl.on("line", (message) => {
      const trimmed = (message || "").trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      const match = trimmed.match(/^!impersonate (\w+)$/);
      if (match) {
        username = match[1];
        console.log(`Now impersonating as ${username}`);
        rl.prompt();
        return;
      }

      if (trimmed === "!exit") {
        username = registeredUsername;
        console.log(`Now you are ${username}`);
        rl.prompt();
        return;
      }

      const signature = signMessage(trimmed);

      socket.emit("message", { username, message: trimmed, signature });

      console.log(`(you as ${username}): ${trimmed}`);
      rl.prompt();
    });
  });
});

socket.on("init", (keys) => {
  keys.forEach(([user, key]) => users.set(user, key));
  console.log(`\nThere are currently ${users.size} users in the chat`);
  rl.prompt();
});

socket.on("newUser", (data) => {
  const { username: newUser, publicKey } = data;
  users.set(newUser, publicKey);
  console.log(`${newUser} join the chat`);
  rl.prompt();
});

socket.on("message", (data) => {
  if (!data || typeof data !== "object") {
    rl.prompt();
    return;
  }

  const { username: senderUsername, message: senderMessage, signature } = data;

  if (senderUsername === registeredUsername) {
    rl.prompt();
    return;
  }

  const senderPublicKey = users.get(senderUsername);

  if (!senderPublicKey) {
    console.log(`[!] ${senderUsername}: ${senderMessage}  -- this user is fake`);
    rl.prompt();
    return;
  }

  if (!signature) {
    console.log(
      `[!] ${senderUsername}: ${senderMessage}  -- this user is fake`
    );
    rl.prompt();
    return;
  }

  const ok = verifySignature(senderPublicKey, senderMessage, signature);

  if (ok) {
    console.log(`${senderUsername}: ${senderMessage}`);
  } else {
    console.log(`[!] ${senderUsername}: ${senderMessage}  -- this user is fake`);
  }

  rl.prompt();
});

socket.on("disconnect", () => {
  console.log("Server disconnected, Exiting...");
  rl.close();
  process.exit(0);
});

rl.on("SIGINT", () => {
  console.log("\nExiting...");
  socket.disconnect();
  rl.close();
  process.exit(0);
});
