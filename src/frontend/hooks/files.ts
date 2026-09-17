// 'background' key prefix prevents passcode prompt during file selection (see AuthContext.tsx)
export const FILE_SELECT_MUTATION_KEY = [
  'background',
  'file',
  'select',
] as const;
