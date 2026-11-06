import { createInterface } from "node:readline/promises";
import { hashPassword } from "../server/auth.js";

/* Pide la contraseña sin mostrarla en pantalla y escribe el hash para pegarlo en .env */
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const out = rl.output;
const write = out.write.bind(out);
let muted = false;
out.write = (chunk, ...rest) => muted ? true : write(chunk, ...rest);

write("Contraseña (mínimo 12 caracteres): ");
muted = true;
const password = await rl.question("");
muted = false;
write("\n");
rl.close();

if (password.length < 12) {
  console.error("La contraseña debe tener al menos 12 caracteres.");
  process.exit(1);
}
console.log("\nPega esta línea en tu .env:\n");
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
