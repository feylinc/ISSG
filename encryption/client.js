const io = require("socket.io-client");
const readline = require("readline");
const crypto = require("crypto");

const socket = io("http://localhost:3000");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" });

function encryptForUser(plaintext, targetPublicKeyPem) {
  const targetKeyObj = crypto.createPublicKey(targetPublicKeyPem);
  const encrypted = crypto.publicEncrypt(
    {
      key: targetKeyObj,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(plaintext)
  );
  return encrypted.toString("base64");
}

function decryptMessage(cipherBase64) {
  try {
    const decrypted = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      },
      Buffer.from(cipherBase64, "base64")
    );
    return decrypted.toString();
  } catch {
    return null; 
  }
}

let targetUsername = "";
let username = "";
const users = new Map(); 

socket.on("connect", () => {
  console.log("Connected to the server");

  rl.question("Enter your username: ", (input) => {
    username = input.trim();

    console.log(`Welcome, ${username} to the chat`);

    socket.emit("registerPublicKey", {
      username,
      publicKey: publicKeyPem,
    });

    rl.prompt();

    rl.on("line", (message) => {
      const trimmed = message.trim();
      if (!trimmed) return rl.prompt();

      let match;
      if ((match = trimmed.match(/^!secret (\w+)$/))) {
        targetUsername = match[1];
        console.log(`Now secretly chatting with ${targetUsername}`);
        return rl.prompt();
      }

      if (trimmed === "!exit") {
        console.log(`Stopped secret chat with ${targetUsername}`);
        targetUsername = "";
        return rl.prompt();
      }

      if (!targetUsername) {
        socket.emit("message", {
          username,
          message: trimmed,
          encrypted: false
        });
        return rl.prompt();
      }

      const targetKey = users.get(targetUsername);
      if (!targetKey) {
        console.log(`Cannot find public key for ${targetUsername}`);
        return rl.prompt();
      }

      const cipher = encryptForUser(trimmed, targetKey);

      socket.emit("message", {
        username,
        message: cipher,
        encrypted: true,
        target: targetUsername
      });

      console.log(`(secret to ${targetUsername}): ${trimmed}`);
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
  console.log(`${newUser} joined the chat`);
  rl.prompt();
});

socket.on("message", (data) => {
  const { username: sender, message, encrypted, target } = data;

  if (sender === username) return rl.prompt();

  if (!encrypted) {
    console.log(`${sender}: ${message}`);
    return rl.prompt();
  }

  if (target === username) {
    const decrypted = decryptMessage(message);
    if (decrypted !== null) {
      console.log(`${sender} (secret): ${decrypted}`);
    } else {
      console.log(`${sender} (secret but failed decrypt)`);
    }
  } else {
    console.log(`${sender} (ciphertext): ${message}`);
  }

  rl.prompt();
});

socket.on("disconnect", () => {
  console.log("Server disconnected.");
  rl.close();
  process.exit(0);
});

rl.on("SIGINT", () => {
  console.log("\nExiting...");
  socket.disconnect();
  rl.close();
  process.exit(0);
});
