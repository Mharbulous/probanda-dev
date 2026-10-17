// The DPAPI store moved to source/mcp-shared/dpapi-store.js, which the practice
// data server compiles too. This module keeps the commons import path.
export {
  defaultStateDir,
  protectLocalSecret,
  readProtectedJson,
  unprotectLocalSecret,
  writeProtectedJson,
} from "../../../mcp-shared/dpapi-store.js";
