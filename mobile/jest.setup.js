/* eslint-env jest */
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => []),
  types: { allFiles: '*/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: () => false,
}));
