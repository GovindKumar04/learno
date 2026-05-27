import bcrypt from "bcrypt";

const hash = await bcrypt.hash("Admin@1234", 10);

console.log(hash);