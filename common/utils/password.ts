import bcrypt from "bcryptjs";

const hash = (password: string) =>
  bcrypt.hashSync(password, bcrypt.genSaltSync(10));
const compare = (password: string, hashedPassword: string) =>
  bcrypt.compareSync(password, hashedPassword);

export { hash, compare };
