import validator from "validator";

const UUID4Validator = (value: string) => {
  if (validator.isUUID(value)) return true;
  return false;
};
export { UUID4Validator };
